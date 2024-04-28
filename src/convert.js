const ethers = require('ethers')
const createContract = require('./contracts')
const { quantile } = require('simple-statistics')
const fetchPrice = require('./price')

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

const calL2GasCost = async (wallet, tx) => {
  const historicalBlocks = 8
  const hist = await wallet.provider.send('eth_feeHistory', [
    historicalBlocks,
    'latest',
    [10, 30, 50, 75],
  ])
  let pWeiValue = trun(samplePWei(hist.reward))
  const bWeiValue = ethers.BigNumber.from(hist.baseFeePerGas[hist.baseFeePerGas.length - 1])
  const gasPrice = bWeiValue.add(pWeiValue)

  return [pWeiValue, gasPrice]
}

const convert = async (wallet) => {
  const rewardTokenAddr = '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db'
  const rewardTokenPrice = await fetchPrice(rewardTokenAddr)
  const ethPrice = await fetchPrice('0x4200000000000000000000000000000000000006')

  const veloContract = createContract(wallet, 'velo')
  const tokenContract = new ethers.Contract(
    rewardTokenAddr,
    ['function balanceOf(address) view returns (uint256)'],
    wallet,
  )
  const balance = await tokenContract.balanceOf(wallet.address)

  const rewardUsd = ethers.utils.formatEther(balance) * rewardTokenPrice

  if (rewardUsd < 10) {
    return
  }

  const amount = await veloContract.getAmountsOut(balance, [
    {
      factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
      from: rewardTokenAddr,
      stable: false,
      to: '0x4200000000000000000000000000000000000006',
    },
  ])

  const ethUsd = ethers.utils.formatEther(amount[1]) * ethPrice

  if (ethUsd < 0.98 * rewardUsd) {
    return
  }

  console.log('try convert')

  const txReq = await veloContract.populateTransaction.swapExactTokensForETH(
    balance,
    amount[1],
    [
      {
        from: rewardTokenAddr,
        to: '0x4200000000000000000000000000000000000006',
        stable: false,
        factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
      },
    ],
    wallet.address,
    parseInt(new Date().getTime() / 1000) + 120,
  )
  const tx = await wallet.populateTransaction(txReq)

  const [pWeiValue, gasPrice] = await calL2GasCost(wallet, tx)

  if (gasPrice.gt(ethers.utils.parseUnits('0.07', 'gwei'))) {
    console.log('gas gwei too high', ethers.utils.formatUnits(gasPrice, 'gwei'))
    return
  }

  tx.maxPriorityFeePerGas = pWeiValue

  const txResponse = await wallet.sendTransaction(tx)
  await txResponse.wait()
  console.log('convert done')
}

module.exports = convert
