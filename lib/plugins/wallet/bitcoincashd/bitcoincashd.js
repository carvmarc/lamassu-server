const jsonRpc = require('../../common/json-rpc')

const bs58check = require('bs58check')
const BN = require('../../../bn')
const E = require('../../../error')
const coinUtils = require('../../../coin-utils')

const cryptoRec = coinUtils.getCryptoCurrency('BCH')
const configPath = coinUtils.configPath(cryptoRec)
const unitScale = cryptoRec.unitScale
const config = jsonRpc.parseConf(configPath)

const rpcConfig = {
  username: config.rpcuser,
  password: config.rpcpassword,
  port: config.rpcport || cryptoRec.defaultPort
}

function fetch (method, params) {
  return jsonRpc.fetch(rpcConfig, method, params)
}

function checkCryptoCode (cryptoCode) {
  if (cryptoCode !== 'BCH') return Promise.reject(new Error('Unsupported crypto: ' + cryptoCode))
  return Promise.resolve()
}

function accountBalance (account, cryptoCode, confirmations) {
  return checkCryptoCode(cryptoCode)
    .then(() => fetch('getbalance', ['', confirmations]))
    .then(r => BN(r).shift(unitScale).round())
}

// We want a balance that includes all spends (0 conf) but only deposits that
// have at least 1 confirmation. getbalance does this for us automatically.
function balance (account, cryptoCode) {
  return accountBalance(account, cryptoCode, 1)
}

function bchToBtcVersion (version) {
  if (version === 0x1c) return 0x00
  if (version === 0x28) return 0x05

  return version
}

// Bitcoin-ABC only accepts BTC style addresses at this point,
// so we need to convert
function bchToBtcAddress (address) {
  const buf = bs58check.decode(address)
  const version = buf[0]
  buf[0] = bchToBtcVersion(version)
  return bs58check.encode(buf)
}

function sendCoins (account, address, cryptoAtoms, cryptoCode) {
  const coins = cryptoAtoms.shift(-unitScale).toFixed(8)

  const btcAddress = bchToBtcAddress(address)

  return checkCryptoCode(cryptoCode)
    .then(() => fetch('sendtoaddress', [btcAddress, coins]))
    .catch(err => {
      if (err.code === -6) throw new E.InsufficientFundsError()
      throw err
    })
}

function newAddress (account, info) {
  return checkCryptoCode(info.cryptoCode)
    .then(() => fetch('getnewaddress'))
}

function addressBalance (address, confs) {
  const btcAddress = bchToBtcAddress(address)

  return fetch('getreceivedbyaddress', [btcAddress, confs])
    .then(r => BN(r).shift(unitScale).round())
}

function confirmedBalance (address, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => addressBalance(address, 1))
}

function pendingBalance (address, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => addressBalance(address, 0))
}

function getStatus (account, toAddress, requested, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => confirmedBalance(toAddress, cryptoCode))
    .then(confirmed => {
      if (confirmed.gte(requested)) return {status: 'confirmed'}

      return pendingBalance(toAddress, cryptoCode)
        .then(pending => {
          if (pending.gte(requested)) return {status: 'authorized'}
          if (pending.gt(0)) return {status: 'insufficientFunds'}
          return {status: 'notSeen'}
        })
    })
}

function newFunding (account, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => {
      const promises = [
        accountBalance(account, cryptoCode, 0),
        accountBalance(account, cryptoCode, 1),
        newAddress(account, {cryptoCode})
      ]

      return Promise.all(promises)
    })
    .then(([fundingPendingBalance, fundingConfirmedBalance, fundingAddress]) => ({
      fundingPendingBalance,
      fundingConfirmedBalance,
      fundingAddress
    }))
}

function cryptoNetwork (account, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => parseInt(rpcConfig.port, 10) === 18332 ? 'test' : 'main')
}

module.exports = {
  balance,
  sendCoins,
  newAddress,
  getStatus,
  newFunding,
  cryptoNetwork
}
