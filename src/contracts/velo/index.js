const ethers = require("ethers")
const abi = require('./abi.json')
require('dotenv').config()

const { VELO_CONTRACT_ADDR } = process.env

const createContract = (wallet) => {
  return new ethers.Contract(VELO_CONTRACT_ADDR, abi, wallet)
}

module.exports = createContract
