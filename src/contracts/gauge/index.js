const ethers = require("ethers")
const abi = require('./abi.json')

const createContract = (wallet, { addr }) => {
  return new ethers.Contract(addr, abi, wallet)
}

module.exports = createContract
