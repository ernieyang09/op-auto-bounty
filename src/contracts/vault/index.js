const ethers = require("ethers")
const abi = require('./abi.json')
require('dotenv').config()

const { VAULT_CONTRACT_ADDR } = process.env

const createContract = (wallet) => {
  return new ethers.Contract(VAULT_CONTRACT_ADDR, abi, wallet)
}

module.exports = createContract
