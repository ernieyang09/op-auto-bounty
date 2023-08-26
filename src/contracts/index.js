const createVaultContract = require('./vault')
const createGaugeContract = require('./gauge')
const createVeloContract = require('./velo')

const create = (wallet, contract, options) =>
  ({
    vault: () => createVaultContract(wallet),
    gauge: (options) => createGaugeContract(wallet, options),
    // use for convert
    velo: (options) => createVeloContract(wallet, options),
  }[contract](options))

module.exports = create
