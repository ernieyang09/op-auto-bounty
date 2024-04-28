const yargs = require('yargs')
const ethers = require('ethers')
const optimismSDK = require('@eth-optimism/sdk')
const Logger = require('log4js')
const { quantile } = require('simple-statistics')
const createContract = require('./src/contracts')
const fetchPrice = require('./src/price')
// not commit
const convert = require('./src/convert')
const limit = require('./src/limiter')
require('dotenv').config()

const { argv } = yargs

const logger = Logger.getLogger()

if (argv.debug) {
  logger.level = Logger.levels.DEBUG
}

const { RPCS, WALLET_PRIVATE_KEY, VAULT_CONTRACT_ADDR, TO_ADDRESS, MIN_REWARD_USD } = process.env

const RPC = RPCS.split(',')[Math.floor(Math.random() * RPCS.split(',').length)]

const minReward = parseFloat(MIN_REWARD_USD)

const trun = (number) => {
  const len = Math.max(number.toString().length - 2, 0)
  return ethers.BigNumber.from(number)
    .div(10 ** len)
    .mul(10 ** len)
}

const samplePWei = (reward) => {
  const r = reward.map((hexValues) => ethers.BigNumber.from(hexValues[0]).toNumber())

  const percentile75 = quantile(r, 0.75)
  const filtered = r.filter((rr) => rr <= percentile75)

  return Math.ceil(
    filtered.reduce((a, b) => {
      return a + b
    }, 0) /
      (filtered.length - 1),
  )
}

const calculateGasFeeUsd = async (wallet, tx) => {
  const calL2GasCost = async () => {
    const l2gas = ethers.BigNumber.from(await wallet.provider.estimateGas(tx))
    const historicalBlocks = 20
    const hist = await wallet.provider.send('eth_feeHistory', [
      historicalBlocks,
      'latest',
      [10, 30, 50, 75],
    ])
    let pWeiValue = trun(samplePWei(hist.reward))
    const bWeiValue = ethers.BigNumber.from(hist.baseFeePerGas[hist.baseFeePerGas.length - 1])
    const gasPrice = bWeiValue.add(pWeiValue)

    console.log('l2gas gwei', ethers.utils.formatUnits(gasPrice, 'gwei'))

    return [pWeiValue, ethers.BigNumber.from(14).mul(l2gas).mul(gasPrice).div(10)]
  }

  const calL1GasCost = async () =>
    ethers.BigNumber.from(await wallet.provider.estimateL1GasCost(tx))
  const fetchEthPrice = async () => await fetchPrice('0x4200000000000000000000000000000000000006')

  const [l1gasCost, [pWeiValue, l2gasCost], ethPrice] = await Promise.all([
    calL1GasCost(),
    calL2GasCost(),
    fetchEthPrice(),
  ])

  const totalWei = l2gasCost.add(l1gasCost)
  const totalEth = ethers.utils.formatEther(totalWei)

  const totalUsd = ethPrice * totalEth

  return [pWeiValue, totalUsd]
}

const main = async () => {
  console.log(`Start: ${new Date().toLocaleString()}`)
  const l2RpcProvider = optimismSDK.asL2Provider(new ethers.providers.JsonRpcProvider(RPC))
  const wallet = new ethers.Wallet(WALLET_PRIVATE_KEY).connect(l2RpcProvider)

  const vaultContract = createContract(wallet, 'vault')

  const taskRunner = async (i) => {
    const res1 = await vaultContract.Pools(i)
    const { gauge, rewardToken } = res1

    const gaugeContract = createContract(wallet, 'gauge', { addr: gauge })
    const rewardTokenAmount =
      ethers.utils.formatEther(await gaugeContract.earned(VAULT_CONTRACT_ADDR)) / 100

    const rewardTokenPrice = await fetchPrice(rewardToken)

    const bountyUsd = rewardTokenPrice * rewardTokenAmount

    if (bountyUsd < 0.11) {
      return
    }

    const txReq = await vaultContract.populateTransaction.claimBounty(i, TO_ADDRESS)
    const tx = await wallet.populateTransaction(txReq)
    const [pWeiValue, totalCost] = await calculateGasFeeUsd(wallet, tx)

    let expectedReward = minReward

    if (argv.random) {
      // -0.02 to 0.07
      const randomValue = Math.random() * 0.09 - 0.02
      expectedReward += randomValue
    }

    console.log(`${i} bounty: ${bountyUsd}, cost: ${totalCost}`)

    if (totalCost > 0.25) {
      return
    }

    if (totalCost > 0.2 && bountyUsd - totalCost < expectedReward * 1.2) {
      return
    }

    if (!(bountyUsd - totalCost >= expectedReward)) {
      return
    }

    console.log(`found ${i}`)

    tx.maxPriorityFeePerGas = pWeiValue

    return tx
  }

  const tasks = [...Array(72)].map((_, i) => taskRunner.bind(this, i))
  const r = (await limit(tasks, 10)).filter((r) => r)

  if (argv.exec) {
    let nonce = await wallet.getTransactionCount()
    for (const tx of r) {
      console.log(`${new Date().toLocaleString()} exec tx`)
      try {
        tx.nonce = nonce
        const txResponse = await wallet.sendTransaction(tx)
        await txResponse.wait()
        nonce += 1
      } catch (e) {
        console.log(e)
        console.log('exec failed')
      }
    }
  }

  // not commit
  if (argv.convert) {
    await convert(wallet)
  }
  console.log(`End: ${new Date().toLocaleString()}`)
}

try {
  main()
} catch (e) {
  console.log(e)
  process.exit()
}
