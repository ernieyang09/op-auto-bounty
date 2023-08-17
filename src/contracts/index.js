const createVaultContract = require('./vault')
const createGaugeContract = require('./gauge')

const create = (wallet, contract, options) => ({
  'vault': () => createVaultContract(wallet),
  'gauge': (options) => createGaugeContract(wallet, options)
}[contract](options))

module.exports = create
