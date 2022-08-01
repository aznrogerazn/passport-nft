# passport-nft

[Passport](https://passportjs.org/) strategy for authenticating with an NFT and a signed challenge for added security. Best used with dApps and a Node.js back-end.

This module lets you authenticate using an on-chain (defaults to Web3/EVM combo) NFT and an off-chain challenge record (usually using a database for long term storage). By using Passport, its very easy for anyone to integrate their own NFT authentication strategy. This module follows [Connect](https://www.senchalabs.org/connect/)-styled middleware, and can be used with [Express.js](https://expressjs.com/) or [Koa.js](https://koajs.com/) and their variants.

---

## Install

```bash
$ npm install https://github.com/aznrogerazn/passport-nft.git --save
```

This module requires `web3.js` to work, since it needs to access on-chain NFT data. Please refer to [Web3.js documentation](https://web3js.readthedocs.io/) for the instance initialisation.

## Usage

#### NFT Contract

Please make sure your NFT has the following interface (minimal requirement):

ERC-721:

```solidity
function balanceOf(address account) external view returns (uint256);
```

ERC-1155:

```solidity
function balanceOf(address account, uint256 id) external view returns (uint256);
```

This Strategy will check the balance of the address with `balanceOf` function after verifying the encrypted challenge. Make sure your wallet address owns the specified NFT to allow authentication. Pass in the address for your NFT in the `Strategy` options.

For Chain ID, it is determined by the `Web3` instance you pass to `Strategy` initialisation. Please make sure it matches with the chain of your NFT deployment.

#### Configure Strategy

The NFT authentication strategy incorporates two elements, after which, the control is passed to your own `verify` function to implement challenge string update or other features (such as issuing a Cookie contianing access token):

1. A prefixed challenge string (with its original obtainable with `getChallenge` option), that will signed with wallet address calling the login.
2. An NFT to check balance against, with your specified list of token IDs.

In other words, your `verify` function will **only** be run if the challenge is verified (matches with `address`), and the `address` owns the NFT. Otherwise, failure to satisfy those requirements will make the Strategy to call `fail` on Passport framework.

Example configuration:
```js
passport.use(new NFTStrategy(
// {Object} Strategy Option
{
  // @dev essential fields:
  // getChallenge: a function accepting `address` as parameter and
  //               should return a challenge string.
  getChallenge: service.users.getChallengeByAddress,
  tokenStandard: 1155, // 721 or 1155
  // @note `tokenIds` is only required for ERC1155
  tokenIds: [1, 2, 3], // Scan those IDs for balance
  //                      only wallets with balance are allowed in
  nftAddress: '0x064f...', // Contract address for the NFT
  // @dev optional fields:
  passReqToCallback: true, // Enables `request` param to third verification function
  strategyIdentifier: 'nft-for-vip', // Customise Strategy identifier
  addressField: 'wallet_address', // Header field name: address
  challengeField: 'encrypted_challenge', // Header field name: signed challenge
  key: 'NFT_AUTH_', // Prefix for the challenge string to encrypt
  autoGrantUser: false, // Set to true to generate a default UserInfo for user object
  customTokenABI: [], // @dev (Reserved)
},
// {Web3} Web3.js Instance
// Reused for each call to save resource
new Web3('https://bsc-dataseed1.binance.org:443'),
// {Function} Verify function
// You can customise this 
(request, userInfo, done) => {
  const { method, url } = request;
  const { Users } = app.model;
  const { address } = userInfo;
  // 1. Off-chain DB: Run findOrCreate on `users` table
  //    (Example uses Sequelize.js ORM v6)
  // @note This behaviour can be done with the help of a
  //       getChallenge function passed in to provide a default
  //       challenge string if data isn't present in database.
  Users.findOrCreate({
    where: { address },
    defaults: {
      // Initialise challenge string with chance.js
      challenge: (new Chance()).string({ alpha: true, numeric: true, }),
    },
  }).then(userObject => {
    // You may update the challenge string for this User
    // And finally, call done() with first parameter being null
    // (because first parameter is for error)
    done(null, userObject);
  }).catch(dbErr => {
    // You may return 4xx or 5xx here, depending on the framework
    // of choice
  });
}));
```

For a complete list of available options, please refer to `lib/strategy.js`.

#### Authenticate Requests

Use `passport.authenticate()`, pass in `"nft"` or your specified `strategyIdentifier` to authenticate requests. Make sure your request headers contain content for both `addressField` and `challengeField` that matches specification.

As of `web3.js` 1.7.0, you may assemble the headers like so:

```js
async function getLoginHeaders(
  web3,
  addressField = 'wallet_address',
  challengeField = 'encrypted_challenge'
) {
  // address: current wallet address
  const address = await web3.eth.personal.getAccounts()[0] || '';
  if (!(web3.utils.isAddress(address))) throw new Error('Connect wallet first');
  // example API call for challenge string
  const challengeStr = await fetch(new Request(`https://some.api.com/getChallenge/${address}`));
  // web3 call to sign the challenge
  // @note this step will show wallet dialogue
  const signature = await web3.eth.personal.sign(
    `NFT_AUTH_${challengeStr}`, // assuming NFT_AUTH_ matches your option.key
    address,
    null
  );
  // return the header object
  const _header = {};
  _header[addressField] = address;
  _header[challengeField] = signature;
  return _header;
};
async function loginByNft(web3) {
  const headers = await getLoginHeaders(web3);
  // This will be the call to your authenticate route,
  // that will call passport.authenticate()
  return fetch(new Request('https://some.api.com/login/nft', { headers }));
}
```

To use the authentication middleware, call it in this pattern (Connect-style middleware, e.g. `Express`) on the server side:

```js
// Authentication Route: NFT
app.get('/login/nft', passport.authenticate('nft'), function(req, res) {
  // If you need redirection afterwards
  res.redirect('/');
  // If this is a separated API (from front-end):
  res.send({
    user: req.user, // assuming `req` has verified user object
  });
});
```

## License

[The MIT License](http://opensource.org/licenses/MIT)

Copyright (c) 2013~2022 yuuko.eth
