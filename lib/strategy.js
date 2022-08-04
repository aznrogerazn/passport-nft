/**
 * NFTStrategy
 * yuuko.eth
 * - Compatible with Common Connect-style middlewares
 */
'use strict';

const util = require('node:util');
const { ERC721ABI, ERC1155ABI } = require('./abi');

const { Strategy: PassportStrategy } = require('passport-strategy');

/**
 * `Strategy` constructor
 *
 * We accept address and encrypted challenge message as validation
 * parameters.
 *
 * Dependency & Setup:
 *
 * 1. Your server must provide a `challenge` string via API.
 *    (Hint: this challenge can be bound to each wallet account
 *    in RDB as nonce for added security. If you provide a static
 *    string, it would work as well. Just make sure your dApp is
 *    sending a corresponding signed message.)
 * 2. `challenge` signed with:
 *    web3.eth.personal.sign(`${options.key}${challenge}`, walletAddress, null);
 *    - During this step, simply concat two strings and pass
 *      into the web3 sign call: `options.key` and `challenge`
 *    - Use default key 'nft:auth_' if it's not supplied in options.
 * 3. Call your login route with this header configuration:
 *    - headers[options._addressField]: wallet address
 *    - headers[options._challengeField]: encrypted challenge with key
 * 4. Middleware shall grant your login, and pass the control to
 *    your specified verify function. (You can set cookie, grant
 *    a JWT, etc. in your function). If options.autoGrantUser is set
 *    to true, default behaviour is to set the User object on ctx.
 *
 * IMPORTANT NOTE ON VERIFY FUNCTION:
 *    It is possible to simply authenticate with a static
 *    challenge string. For testing purposes, this should be enough.
 *    Please consider one-time value for added security.
 *
 * This module will:
 * 1. Make sure your signed challenge matches the address used to sign
 *    it.
 * 2. Make sure your verified address has balance on the specified
 *    NFT. If not, the authentication fails with 401 by the framework.
 * 3. Pass the control to your verify function.
 *
 * Example options:
 * {
 *   // @dev essential fields:
 *   // @note getChallenge {Function} a function accepting `address`
 *   //       as parameter and should return a challenge string.
 *   getChallenge: service.wallets.getChallengeByAddress,
 *   // @note challenge {String} fallback string if `getChallenge`
 *   //       is not supplied or failed during execution. Default
 *   //       value below.
 *   challenge: 'a_simple_challenge_from_api_server',
 *   // @note tokenStandard {Number} token standard: 721 or 1155
 *   tokenStandard: 1155,
 *   // @note tokenIds {Array} is only required for ERC1155
 *   //       Will scan those IDs for balance:
 *   tokenIds: [ 1, 2, 3 ],
 *   nftAddress: '0x55d398326f99059fF775485246999027B3197955',
 *   // @dev optional fields:
 *   // @note addressField {String} header field name: address
 *   addressField: 'wallet_address',
 *   // @note challengeField {String} header field name: encrypted
 *   //       challenge
 *   challengeField: 'encrypted_challenge',
 *   // @dev key {String} prefix to the challenge before encryption.
 *   //      Default value below
 *   key: 'nft:auth_',
 *   // @note strategyIdentifier {String} Strategy identifier in Passport.
 *   //       Default value below
 *   strategyIdentifier: 'nft',
 *   // @note passReqToCallback {Boolean} Do I pass `req` to `verify` as
 *   //       its first param? Default value below
 *   passReqToCallback: true,
 *   // @note autoGrantUser {Boolean} Do I attach `userInfo` to `req`?
 *   autoGrantUser: false,
 *   // @note Reserved.
 *   customTokenABI: [],
 * }
 *
 * Example usage:
 * // @note passReqToCallback: true
 * new NFTStrategy(_options, web3, (req, address, done) => {});
 * // @note passReqToCallback: false
 * new NFTStrategy(_options, web3, (address, done) => {});
 *
 */
class NFTStrategy extends PassportStrategy {
  constructor(options, web3, verify = function() {}) {
    super();
    if (!web3) throw new TypeError('[NFTStrategy] No web3 instance supplied');
    if (!web3.eth) throw new TypeError('[NFTStrategy] Not a valid web3 instance');
    if (!web3.eth.currentProvider) throw new TypeError('[NFTStrategy] No provider set. Please initialise web3 first.');
    this.web3 = web3;
    if (!verify) throw new TypeError('[NFTStrategy] No verify function supplied');
    this._challenge = typeof options.challenge === 'string' ? options.challenge : 'a_simple_challenge_from_api_server';
    if (Object.keys(options).includes('getChallenge') && typeof options.getChallenge === 'function') {
      this._asyncGetChallenge = (options.getChallenge() instanceof Promise);
      this._getChallenge = options.getChallenge;
    } else {
      this._asyncGetChallenge = true;
      this._getChallenge = async () => `${this._challenge}`;
    }
    if (!options.tokenStandard) throw new TypeError('[NFTStrategy] options.tokenStandard is required');
    if (!([ 721, 1155 ].includes(options.tokenStandard))) throw new TypeError('[NFTStrategy] options.tokenStandard ERC identifier error');
    if (!options.nftAddress) throw new TypeError('[NFTStrategy] options.nftAddress is required');
    if (!web3.utils.isAddress(options.nftAddress)) throw new TypeError('[NFTStrategy] options.nftAddress invalid address');
    this._nftAddress = options.nftAddress;
    this._tokenStandard = options.tokenStandard;
    if (options.tokenStandard === 1155) {
      if (!options.tokenIds) throw new TypeError('[NFTStrategy] options.tokenIds is required');
      if (!(options.tokenIds instanceof Array)) throw new TypeError('[NFTStrategy] options.tokenIds should be Array');
      this._tokenIds = options.tokenIds;
    }
    this._addressField = options.addressField || 'auth_wallet_address';
    this._challengeField = options.challengeField || 'auth_web3_challenge';
    this._key = options.key || 'nft:auth_';
    this._passReqToCallback = options.passReqToCallback || true;
    this._autoGrantUser = options.autoGrantUser || false;
    if (options.customTokenABI && !(options.customTokenABI instanceof Array)) throw new TypeError('[NFTStrategy] Please check your custom ABI');
    this._customTokenABI = options.customTokenABI || null;
    this._verify = verify;
    this.name = options.strategyIdentifier || 'nft';
  }
  get key() {
    return this._key;
  }
  /**
   * @function authenticate
   * @param {IncomingMessage} req Request
   */
  authenticate(req) {
    const _instance = this;
    const web3 = this.web3;
    // 1. Extract the Address in header from request
    const address = req.headers[_instance._addressField];
    const encryptedChallenge = req.headers[_instance._challengeField];
    // 2. Signature verification
    const challengeFunction = _instance._asyncGetChallenge
      ? util.callbackify(_instance._getChallenge)
      : _instance._getChallenge;
    try {
      challengeFunction(address, (err, res = '') => {
        try {
          if (err) throw err;
          if (!res) throw new TypeError('[NFTStrategy::authenticate] Challenge string invalid');
          const resultAddress = web3.eth.accounts.recover(`${_instance.key}${res}`, encryptedChallenge);
          if (resultAddress.toLowerCase() !== address.toLowerCase()) throw new Error(`[NFTStrategy] Address mismatch?! (result) ${resultAddress} vs (param) ${address}`);
          // 3. Address match. Check NFT balance.
          const abi = _instance._customTokenABI
            ? _instance._customTokenABI
            : (_instance._tokenStandard === 721
              ? ERC721ABI : ERC1155ABI);
          const nft = new web3.eth.Contract(abi, _instance._nftAddress);
          // (wrapper)
          const checkNftBalance = function() {
            return new Promise((resolve, rej) => {
              if (_instance._tokenStandard === 721) {
                nft.methods.balanceOf(address).call().then(balance => {
                  if (Number(balance) === 0) rej(new Error(`[NFTStrategy::authenticate] ${address} has no balance on target NFT`));
                  resolve(Number(balance));
                });
              } else if (_instance._tokenStandard === 1155) {
                const promises = [];
                for (let i = 0; i < _instance._tokenIds.length; ++i) {
                  promises.push(new Promise(_res => {
                    nft.methods.balanceOf(address, _instance._tokenIds[i]).call().then(balance => {
                      _res(balance);
                    });
                  }));
                }
                Promise.all(promises).then(results => {
                  let totalBalance = 0;
                  for (let i = 0; i < results.length; ++i) {
                    totalBalance += Number(results[i]);
                  }
                  if (totalBalance === 0) rej(new Error(`[NFTStrategy::authenticate] ${address} has no balance on target NFT`));
                  resolve(totalBalance);
                });
              }
            });
          };
          checkNftBalance().then(balance => {
            // 4. Pass control to verify
            function verified(__err, user, info) {
              if (__err) return _instance.fail(__err);
              if (!user) return _instance.fail(info);
              _instance.success(user, info);
            }
            if (_instance._autoGrantUser) {
              req.user = {
                address,
                nftBalance: balance,
              };
            }
            const userInfo = {
              address,
              nftBalance: balance,
            };
            try {
              if (_instance._passReqToCallback) {
                this._verify(req, userInfo, verified);
              } else {
                this._verify(userInfo, verified);
              }
            } catch (err) {
              return _instance.fail(err);
            }
          }).catch(__err => {
            _instance.fail({ message: __err.message });
          });
        } catch (___err) {
          _instance.fail({ message: ___err.message });
        }
      });
    } catch (error) {
      return _instance.fail(error);
    }
  }
}

module.exports = NFTStrategy;
