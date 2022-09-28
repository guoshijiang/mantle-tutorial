const { utils, providers, Wallet } = require('ethers')
const {
  EthBridger,
  getL2Network,
  addCustomNetwork,
  L1ToL2MessageStatus,
} = require('@mantlenetworkio/sdk')
const { parseEther } = utils
const { mtLog, requireEnvVariables } = require('mt-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L1RPC', 'L2RPC'])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

/**
 * Set the amount to be deposited in L2 (in wei)
 */
const ethToL2DepositAmount = parseEther('100000')

const main = async () => {
  await mtLog('Deposit Eth via Mantle SDK')
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
  const l2Network = await getL2Network(l2Provider)
  const ethBridger = new EthBridger(l2Network)

  console.log(l2Network)

  /**
   * First, let's check the l2Wallet initial ETH balance
   */
  const l2WalletInitialEthBalance = await l2Wallet.getBalance()
  console.log('l2Wallet =', l2Wallet.address)
  console.log('l2WalletInitialEthBalance =', l2WalletInitialEthBalance)
  /**
   * transfer ether from L1 to L2
   * This convenience method automatically queries for the retryable's max submission cost and forwards the appropriate amount to L2
   * Arguments required are:
   * (1) amount: The amount of ETH to be transferred to L2
   * (2) l1Signer: The L1 address transferring ETH to L2
   * (3) l2Provider: An l2 provider
   */
  const depositTx = await ethBridger.deposit({
    amount: ethToL2DepositAmount,
    l1Signer: l1Wallet,
    l2Provider: l2Provider,
  })

  const depositRec = await depositTx.wait()
  console.warn('deposit L1 receipt is:', depositRec.transactionHash)

  /**
   * With the transaction confirmed on L1, we now wait for the L2 side (i.e., balance credited to L2) to be confirmed as well.
   * Here we're waiting for the Sequencer to include the L2 message in its off-chain queue. The Sequencer should include it in under 10 minutes.
   */
  console.warn('Now we wait for L2 side of the transaction to be executed ⏳')
  const l2Result = await depositRec.waitForL2(l2Provider)

  /**
   * The `complete` boolean tells us if the l1 to l2 message was successul
   */
  l2Result.complete
    ? console.log(
        `L2 message successful: status: ${L1ToL2MessageStatus[l2Result.status]}`
      )
    : console.log(
        `L2 message failed: status ${L1ToL2MessageStatus[l2Result.status]}`
      )

  /**
   * Our l2Wallet ETH balance should be updated now
   */
  const l2WalletUpdatedEthBalance = await l2Wallet.getBalance()
  console.log(
    `your L2 ETH balance is updated from ${l2WalletInitialEthBalance.toString()} to ${l2WalletUpdatedEthBalance.toString()}`
  )
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
