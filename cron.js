const yargs = require("yargs");
const ethers = require("ethers")
const optimismSDK = require("@eth-optimism/sdk")
const { quantile } = require('simple-statistics')
const createContract = require('./src/contracts')
const fetchPrice = require('./src/price')
const limit = require('./src/limiter')
require('dotenv').config()

const { argv } = yargs

const { ALCHEMY_API_KEY, WALLET_PRIVATE_KEY, VAULT_CONTRACT_ADDR, TO_ADDRESS, MIN_REWARD_USD  } = process.env

const minReward = parseFloat(MIN_REWARD_USD)
const alchemyEndpoint = `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`

const trun = (number) => {
  const len = Math.min(number.toString().length - 2, 1)
  return ethers.BigNumber.from(number).div(10 ** len).mul(10 ** len)
}

const samplePWei = (reward) => {
  const r = reward.map((hexValues) => ethers.BigNumber.from(hexValues[0]).toNumber())
  
  const percentile75 = quantile(r, 0.75)
  const filtered = r.filter((rr) => rr <= percentile75)

  return Math.ceil(filtered.reduce((a, b)=> { return a + b }, 0) / (filtered.length - 1))
}

const calculateGasFeeUsd = async (wallet, tx) => {

  const calL2GasCost = async () => {
    const l2gas = ethers.BigNumber.from(await wallet.provider.estimateGas(tx))
    const historicalBlocks = 20
    const hist = await wallet.provider.send('eth_feeHistory', [
      historicalBlocks,
      'latest',
      [20,45],
    ])
    let pWeiValue = trun(samplePWei(hist.reward))
    const bWeiValue = ethers.BigNumber.from(hist.baseFeePerGas[hist.baseFeePerGas.length-1])
    const gasPrice = bWeiValue.add(pWeiValue)

    console.log('l2gas gwei', ethers.utils.formatUnits(gasPrice, 'gwei'))

    return [pWeiValue, ethers.BigNumber.from(15).div(10).mul(l2gas).mul(gasPrice)]
  }

  const calL1GasCost = async () => ethers.BigNumber.from(await wallet.provider.estimateL1GasCost(tx))
  const fetchEthPrice = async () => await fetchPrice('0x4200000000000000000000000000000000000006')

  const [l1gasCost, [pWeiValue, l2gasCost], ethPrice] = await Promise.all([calL1GasCost(), calL2GasCost(), fetchEthPrice()])

  const totalWei = l2gasCost.add(l1gasCost)
  const totalEth = ethers.utils.formatEther(totalWei);

  const totalUsd = ethPrice * totalEth
  
  return [pWeiValue, totalUsd]

}


const main = async () => {
  const l2RpcProvider = optimismSDK.asL2Provider(new ethers.providers.JsonRpcProvider(alchemyEndpoint))
  const wallet = new ethers.Wallet(WALLET_PRIVATE_KEY).connect(l2RpcProvider)

  const vaultContract = createContract(wallet, 'vault')

  const taskRunner = async (i) => {
    console.log(i)
    const res1 = await vaultContract.Pools(i)
    const { gauge, rewardToken } = res1
  
    const gaugeContract = createContract(wallet, 'gauge', { addr: gauge })
    const rewardTokenAmount = ethers.utils.formatEther(await gaugeContract.earned(VAULT_CONTRACT_ADDR))
    const rewardTokenPrice = await fetchPrice(rewardToken)
    
    const bountyUsd = .01 * rewardTokenPrice * rewardTokenAmount

    if (bountyUsd < 0.05) {
      return 0
    }
    
  
    const txReq = await vaultContract.populateTransaction.claimBounty(i, TO_ADDRESS)
    const tx = await wallet.populateTransaction(txReq)
    const [pWeiValue, totalCost] = await calculateGasFeeUsd(wallet, tx)

    console.log(i, bountyUsd, totalCost)

    let expectedReward = minReward

    if (argv.random) {
      const randomValue = (Math.random() * 0.06) - 0.03
      expectedReward += randomValue
    }

    if (!(bountyUsd - totalCost >= expectedReward)) {
      return bountyUsd - totalCost
    }

    console.log(`found ${i}`)

    if (argv.exec) {
      console.log(`exec ${i}`)
      tx.maxPriorityFeePerGas = pWeiValue

      const txResponse = await wallet.sendTransaction(tx);
      const receipt = await txResponse.wait();
      console.log(receipt)
    }

    return bountyUsd - totalCost
  }

  const tasks = [...Array(68)].map((_,i) => taskRunner.bind(this, i))

  const r = await limit(tasks, 6)

  console.log(r)

}


main()
