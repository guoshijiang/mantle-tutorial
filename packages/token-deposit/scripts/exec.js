const { ethers } = require('hardhat')
const { BigNumber, providers, Wallet } = require('ethers')
const {
  getL2Network,
  Erc20Bridger,
  L1ToL2MessageStatus,
  addCustomNetwork,
} = require('@mantlenetworkio/sdk')
const { mtLog, requireEnvVariables } = require('mt-shared-dependencies')
const { expect } = require('chai')
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
 * Set the amount of token to be transferred to L2
 */
const tokenDepositAmount = BigNumber.from(50)

const main = async () => {
  await mtLog('Deposit token using Mantle SDK')
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
   * Use l2Network to create an Mantle SDK Erc20Bridger instance
   * We'll use Erc20Bridger for its convenience methods around transferring token to L2
   */
  const l2Network = await getL2Network(l2Provider)
  const erc20Bridge = new Erc20Bridger(l2Network)

  /**
   * For the purpose of our tests, here we deploy an standard ERC20 token (DappToken) to L1
   * It sends its deployer (us) the initial supply of 1000000000000000
   */
  console.log('Deploying the test DappToken to L1:')
  const L1DappToken = await (
    await ethers.getContractFactory('DappToken')
  ).connect(l1Wallet)
  const l1DappToken = await L1DappToken.deploy(1000000000000000)
  await l1DappToken.deployed()
  console.log(`DappToken is deployed to L1 at ${l1DappToken.address}`)
  console.log('Approving:')
  const erc20Address = l1DappToken.address

  /**
   * We get the address of L1 Gateway for our DappToken, which later helps us to get the initial token balance of Bridge (before deposit)
   */
  const expectedL1GatewayAddress = await erc20Bridge.getL1GatewayAddress(
    erc20Address,
    l1Provider
  )
  const initialBridgeTokenBalance = await l1DappToken.balanceOf(
    expectedL1GatewayAddress
  )

  /**
   * The Standard Gateway contract will ultimately be making the token transfer call; thus, that's the contract we need to approve.
   * erc20Bridge.approveToken handles this approval
   * Arguments required are:
   * (1) l1Signer: The L1 address transferring token to L2
   * (2) erc20L1Address: L1 address of the ERC20 token to be depositted to L2
   */
  const approveTx = await erc20Bridge.approveToken({
    l1Signer: l1Wallet,
    erc20L1Address: erc20Address,
  })

  const approveRec = await approveTx.wait()
  console.log(
    `You successfully allowed the Mantle Bridge to spend DappToken ${approveRec.transactionHash}`
  )

  /**
   * Deposit DappToken to L2 using erc20Bridge. This will escrow funds in the Gateway contract on L1, and send a message to mint tokens on L2.
   * The erc20Bridge.deposit method handles computing the necessary fees for automatic-execution of retryable tickets — maxSubmission cost & l2 gas price * gas — and will automatically forward the fees to L2 as callvalue
   * Also note that since this is the first DappToken deposit onto L2, a standard Arb ERC20 contract will automatically be deployed.
   * Arguments required are:
   * (1) amount: The amount of tokens to be transferred to L2
   * (2) erc20L1Address: L1 address of the ERC20 token to be depositted to L2
   * (2) l1Signer: The L1 address transferring token to L2
   * (3) l2Provider: An l2 provider
   */
  const depositTx = await erc20Bridge.deposit({
    amount: tokenDepositAmount,
    erc20L1Address: erc20Address,
    l1Signer: l1Wallet,
    l2Provider: l2Provider,
  })

  /**
   * Now we wait for L1 and L2 side of transactions to be confirmed
   */
  const depositRec = await depositTx.wait()
  // const l2Result = await depositRec.waitForL2(l2Provider)
  //
  // /**
  //  * The `complete` boolean tells us if the l1 to l2 message was successul
  //  */
  // l2Result.complete
  //   ? console.log(
  //       `L2 message successful: status: ${L1ToL2MessageStatus[l2Result.status]}`
  //     )
  //   : console.log(
  //       `L2 message failed: status ${L1ToL2MessageStatus[l2Result.status]}`
  //     )

  /**
   * Get the Bridge token balance
   */
  const finalBridgeTokenBalance = await l1DappToken.balanceOf(
    expectedL1GatewayAddress
  )

  /**
   * Check if Bridge balance has been updated correctly
   */
  expect(
    initialBridgeTokenBalance
      .add(tokenDepositAmount)
      .eq(finalBridgeTokenBalance),
    'bridge balance not updated after L1 token deposit txn'
  ).to.be.true

  /**
   * Check if our l2Wallet DappToken balance has been updated correctly
   * To do so, we use erc20Bridge to get the l2Token address and contract
   */
  const l2TokenAddress = await erc20Bridge.getL2ERC20Address(
    erc20Address,
    l1Provider
  )
  console.log('l2TokenAddress=', l2TokenAddress)
  const l2Token = erc20Bridge.getL2TokenContract(l2Provider, l2TokenAddress)
  console.log('l2Token=', l2Token)
  const testWalletL2Balance = (
    await l2Token.functions.balanceOf(l2Wallet.address)
  )[0]
  expect(
    testWalletL2Balance.eq(tokenDepositAmount),
    'l2 wallet not updated after deposit'
  ).to.be.true
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
