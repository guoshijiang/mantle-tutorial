const { utils, providers, Wallet } = require('ethers')
const {
  EthBridger,
  getL2Network,
  L2ToL1Message,
  addCustomNetwork,
} = require('@mantlenetworkio/sdk')
const { parseEther } = utils
const { mtLog, requireEnvVariables } = require('mt-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L2RPC', 'L1RPC'])

/**
 * Set up: instantiate L2 wallet connected to provider
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

/**
 * Set the amount to be withdrawn from L2 (in wei)
 */
const ethFromL2WithdrawAmount = parseEther('10')

const main = async () => {
  await mtLog('Withdraw Eth via Mantle SDK')
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

  /**
   * Use l2Network to create an Mantle SDK EthBridger instance
   * We'll use EthBridger for its convenience methods around transferring ETH from L2 to L1
   */

  const l2Network = await getL2Network(l2Provider)
  const ethBridger = new EthBridger(l2Network)

  /**
   * First, let's check our L2 wallet's initial ETH balance and ensure there's some ETH to withdraw
   */
  const l2WalletInitialEthBalance = await l2Wallet.getBalance()

  if (l2WalletInitialEthBalance.lt(ethFromL2WithdrawAmount)) {
    console.log(
      `Oops - not enough ether; fund your account L2 wallet currently ${l2Wallet.address} with at least 0.000001 ether`
    )
    process.exit(1)
  }
  console.log('Wallet properly funded: initiating withdrawal now')
  console.log('l2WalletInitialEthBalance====', l2WalletInitialEthBalance)
  /**
   * We're ready to withdraw ETH using the ethBridger instance from Mantle SDK
   * It will use our current wallet's address as the default destination
   */

  const withdrawTx = await ethBridger.withdraw({
    amount: ethFromL2WithdrawAmount,
    l2Signer: l2Wallet,
  })
  console.log('enter here ......')
  const withdrawRec = await withdrawTx.wait()

  /**
   * And with that, our withdrawal is initiated! No additional time-sensitive actions are required.
   * Any time after the transaction's assertion is confirmed, funds can be transferred out of the bridge via the outbox contract
   * We'll display the withdrawals event data here:
   */
  console.log(`Ether withdrawal initiated! 🥳 ${withdrawRec.transactionHash}`)

  const withdrawEventsData = await withdrawRec.getL2ToL1Events()
  console.log('Withdrawal data:', withdrawEventsData)
  console.log(
    `To to claim funds (after dispute period), see outbox-execute repo ✌️`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
