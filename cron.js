// const BigNumber = require('bignumber.js')
const ethers = require("ethers")
const optimismSDK = require("@eth-optimism/sdk")
const { quantile } = require('simple-statistics')
const createContract = require('./src/contracts')
const fetchPrice = require('./src/price')
require('dotenv').config()

const { ALCHEMY_API_KEY, WALLET_PRIVATE_KEY, VAULT_CONTRACT_ADDR, TO_ADDRESS, MIN_REWARD_USD  } = process.env
const minReward = parseFloat(MIN_REWARD_USD)
const alchemyEndpoint = `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`


const samplePWei = (reward) => {
  const r = reward.map((hexValues) => ethers.BigNumber.from(hexValues[0]).toNumber())
  
  const percentile75 = quantile(r, 0.75)
  const filtered = r.filter((rr) => rr <= percentile75)

  return ethers.BigNumber.from(Math.ceil(filtered.reduce((a, b)=> { return a + b }, 0) / (filtered.length - 1)))
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
    const pWeiValue = samplePWei(hist.reward)
    const bWeiValue = ethers.BigNumber.from(hist.baseFeePerGas[hist.baseFeePerGas.length-1])
    const gasPrice = bWeiValue.add(pWeiValue)
    return [gasPrice, ethers.BigNumber.from(15).mul(l2gas).mul(gasPrice)]
  }

  const calL1GasCost = async () => ethers.BigNumber.from(await wallet.provider.estimateL1GasCost(tx))
  const fetchEthPrice = async () => await fetchPrice('0x4200000000000000000000000000000000000006')
  

  const [l1gasCost, [gasPrice, l2gasCost], ethPrice] = await Promise.all([calL1GasCost, calL2GasCost, fetchEthPrice])
  
  const totalWei = l2gasCost.add(l1gasCost)
  const totalEth = ethers.utils.formatEther(totalWei);

  const totalUsd = ethPrice * totalEth
  
  return [gasPrice, totalUsd]

}


const main = async () => {
  const l2RpcProvider = optimismSDK.asL2Provider(new ethers.providers.JsonRpcProvider(alchemyEndpoint))
  const wallet = new ethers.Wallet(WALLET_PRIVATE_KEY).connect(l2RpcProvider)

  const vaultContract = createContract(wallet, 'vault')

  // vaultContract

  for (const i of [...Array(68)].map((_,i) => i)) {
    console.log(i)
    const res1 = await vaultContract.Pools(i)
    const { gauge, rewardToken } = res1
  
    const gaugeContract = createContract(wallet, 'gauge', { addr: gauge })
    const rewardTokenAmount = ethers.utils.formatEther(await gaugeContract.earned(VAULT_CONTRACT_ADDR))
    const rewardTokenPrice = await fetchPrice(rewardToken)
    
    const bountyUsd = .01 * rewardTokenPrice * rewardTokenAmount
  
    const txReq = await vaultContract.populateTransaction.claimBounty(i, TO_ADDRESS)
    const tx = await wallet.populateTransaction(txReq)
    const [gasPrice, totalCost] = await calculateGasFeeUsd(wallet, tx)

    console.log('l2gas gwei', ethers.utils.formatUnits(gasPrice, 'gwei'))
    console.log(bountyUsd, totalCost)
  
    if (!(bountyUsd - totalCost >= minReward)) {
      // console.log(88)
      continue
    }
  
    // TODO
    // console.log(totalCost, bountyUsd, 123123)
  
    process.exit()
  }

  // let realTx = await vaultContract.claimBounty(0, TO_ADDRESS)
  // realTx.gasPrice = gasPrice

  // const r = await realTx.wait()

  
}


main()
