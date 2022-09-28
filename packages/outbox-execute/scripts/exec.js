const { providers, Wallet } = require('ethers')
const {
  L2TransactionReceipt,
  L2ToL1MessageStatus,
  addCustomNetwork,
} = require('@mantlenetworkio/sdk')
const { mtLog, requireEnvVariables } = require('mt-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L2RPC', 'L1RPC'])

/**
 * Set up: instantiate L1 wallet connected to provider
 */

const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)
const l1Wallet = new Wallet(walletPrivateKey, l1Provider)

module.exports = async txnHash => {
  await mtLog('Outbox Execution')
  /**
   / * We start with a txn hash; we assume this is transaction that triggered an L2 to L1 Message on L2 (i.e., ArbSys.sendTxToL1)
  */
  await addCustomNetwork({
    customL1Network: {
      blockTime: 10,
      chainID: 1337,
      explorerUrl: '',
      isCustom: true,
      name: 'EthLocal',
      partnerChainIDs: [412346],
      rpcURL: 'http://localhost:8545',
    },
    customL2Network: {
      chainID: 412346,
      confirmPeriodBlocks: 20,
      ethBridge: {
        bridge: '0x6fcbed67d3d629cdb023572cad5e1998ce31e5a7',
        inbox: '0x134c361bd6aad51e73c355ff4e4271579350cce2',
        outbox: '0xd816c017d91303a2818007477EaFfB96EB4ff12C',
        rollup: '0x5e4f84b190fa605ce7534734bbdef830c45c8d88',
        sequencerInbox: '0x125983340cd4746258aeb74d6ce2826618b5e38f',
      },
      explorerUrl: '',
      isMantle: true,
      isCustom: true,
      name: 'MantleLocal',
      partnerChainID: 1337,
      rpcURL: 'http://localhost:8547',
      retryableLifetimeSeconds: 604800,
      tokenBridge: {
        l1CustomGateway: '0xC57fa1B60cA96120E748e0e8DbA3e21A58Cb24B3',
        l1ERC20Gateway: '0x83A46d6860d3A8b7014d5725Fd2e6D663CaF9A29',
        l1GatewayRouter: '0xF11A8240953C970163F8834E21676D356a7a363A',
        l1MultiCall: '0x7979e2762bEdFE5733752417A0b03C365cF55215',
        l1ProxyAdmin: '0x6E21ffF682446415d8D1640F9819Fa1889875f71',
        l1Weth: '0x7768B1759e984371f7231fc63981458F8E581868',
        l1WethGateway: '0xF70afe81a2498d3cD7204F2451E46f9C5D98Bd76',
        l2CustomGateway: '0x5B328f060Ac623A8e9EB9C6F5A7947F3Cdd82b37',
        l2ERC20Gateway: '0x82993066c224A90b6712df2E77CdB7Aa0BD47Eb8',
        l2GatewayRouter: '0x95B63F1d74B04B86226Efb622f7E55C56d068e96',
        l2Multicall: '0xF686e1c5Fc9aE9D1FAE286f7ECCb2ad236829Dc0',
        l2ProxyAdmin: '0xa93366dF17044ed01c3160D2b2cb04f943Ac0D1f',
        l2Weth: '0x6d31A13358286596D1EC30944A7e787fAF1eE757',
        l2WethGateway: '0x3A85e361917180567F6a0fb8c68B2b5065126aCA',
      },
    },
  })

  if (!txnHash)
    throw new Error(
      'Provide a transaction hash of an L2 transaction that sends an L2 to L1 message'
    )
  if (!txnHash.startsWith('0x') || txnHash.trim().length != 66)
    throw new Error(`Hmm, ${txnHash} doesn't look like a txn hash...`)

  /**
   * First, let's find the Mantle txn from the txn hash provided
   */
  const receipt = await l2Provider.getTransactionReceipt(txnHash)
  const l2Receipt = new L2TransactionReceipt(receipt)

  /**
   * Note that in principle, a single transaction could trigger any number of outgoing messages; the common case will be there's only one.
   * For the sake of this script, we assume there's only one / just grad the first one.
   */
  const messages = await l2Receipt.getL2ToL1Messages(l1Wallet, l2Provider)
  const l2ToL1Msg = messages[0]

  /**
   * Check if already executed
   */
  if ((await l2ToL1Msg.status(l2Provider)) == L2ToL1MessageStatus.EXECUTED) {
    console.log(`Message already executed! Nothing else to do here`)
    process.exit(1)
  }

  /**
   * before we try to execute out message, we need to make sure the l2 block it's included in is confirmed! (It can only be confirmed after the dispute period; Mantle is an optimistic rollup after-all)
   * waitUntilReadyToExecute() waits until the item outbox entry exists
   */
  const timeToWaitMs = 1000 * 60
  console.log(
    "Waiting for the outbox entry to be created. This only happens when the L2 block is confirmed on L1, ~1 week after it's creation."
  )
  await l2ToL1Msg.waitUntilReadyToExecute(l2Provider, timeToWaitMs)
  console.log('Outbox entry exists! Trying to execute now')

  /**
   * Now that its confirmed and not executed, we can execute our message in its outbox entry.
   */
  const res = await l2ToL1Msg.execute(l2Provider)
  const rec = await res.wait()
  console.log('Done! Your transaction is executed', rec)
}
