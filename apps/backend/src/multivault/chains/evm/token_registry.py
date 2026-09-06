"""
Preset ERC20 token registry for major EVM mainnets.

Provides a hardcoded list of well-known tokens (stablecoins, wrapped assets,
DeFi blue-chips) per chain_id. Used during asset sync to auto-discover tokens
with non-zero balances.

Contract addresses sourced from official block explorers and verified
against on-chain deployments.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PresetToken:
    """A well-known ERC20 token on a specific chain."""

    symbol: str
    name: str
    address: str  # EIP-55 checksum address
    decimals: int


def get_preset_tokens(chain_id: int) -> list[PresetToken]:
    """Return preset token list for a chain. Empty list if not covered."""
    return list(_PRESET_TOKENS.get(chain_id, []))


# ---------------------------------------------------------------------------
# Token data by chain_id
# ---------------------------------------------------------------------------

_ETHEREUM: list[PresetToken] = [
    # Stablecoins
    PresetToken("USDT", "Tether USD", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    PresetToken("USDC", "USD Coin", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    PresetToken("DAI", "Dai Stablecoin", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    # Wrapped assets
    PresetToken("WETH", "Wrapped Ether", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
    PresetToken("WBTC", "Wrapped BTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
    # Liquid staking
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", 18),
    PresetToken("rETH", "Rocket Pool ETH", "0xae78736Cd615f374D3085123A210448E74Fc6393", 18),
    PresetToken("cbETH", "Coinbase Wrapped Staked ETH", "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", 18),
    # DeFi governance
    PresetToken("UNI", "Uniswap", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18),
    PresetToken("LINK", "ChainLink Token", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18),
    PresetToken("AAVE", "Aave Token", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18),
    PresetToken("MKR", "Maker", "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", 18),
    PresetToken("LDO", "Lido DAO Token", "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", 18),
    PresetToken("CRV", "Curve DAO Token", "0xD533a949740bb3306d119CC777fa900bA034cd52", 18),
    PresetToken("COMP", "Compound", "0xc00e94Cb662C3520282E6f5717214004A7f26888", 18),
    PresetToken("SNX", "Synthetix Network Token", "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", 18),
    PresetToken("GRT", "The Graph", "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", 18),
    PresetToken("ENS", "Ethereum Name Service", "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", 18),
    PresetToken("1INCH", "1inch", "0x111111111117dC0aa78b770fA6A738034120C302", 18),
    PresetToken("PENDLE", "Pendle", "0x808507121B80c02388fAd14726482e061B8da827", 18),
]

_OPTIMISM: list[PresetToken] = [
    PresetToken("USDT", "Tether USD", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6),
    PresetToken("USDC", "USD Coin", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6),
    PresetToken("USDC.e", "Bridged USD Coin", "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", 6),
    PresetToken("DAI", "Dai Stablecoin", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
    PresetToken("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
    PresetToken("WBTC", "Wrapped BTC", "0x68f180fcCe6836688e9084f035309E29Bf0A2095", 8),
    PresetToken("OP", "Optimism", "0x4200000000000000000000000000000000000042", 18),
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", 18),
    PresetToken("rETH", "Rocket Pool ETH", "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D", 18),
    PresetToken("LINK", "ChainLink Token", "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6", 18),
    PresetToken("SNX", "Synthetix Network Token", "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4", 18),
    PresetToken("AAVE", "Aave Token", "0x76FB31fb4af56892A25e32cFC43De717950c9278", 18),
]

_BNB_CHAIN: list[PresetToken] = [
    PresetToken("USDT", "Tether USD (BSC-USD)", "0x55d398326f99059fF775485246999027B3197955", 18),
    PresetToken("USDC", "USD Coin", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
    PresetToken("DAI", "Dai Token", "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", 18),
    PresetToken("WBNB", "Wrapped BNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18),
    PresetToken("BTCB", "Binance-Peg BTCB", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18),
    PresetToken("ETH", "Binance-Peg Ethereum", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18),
    PresetToken("CAKE", "PancakeSwap Token", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 18),
    PresetToken("LINK", "ChainLink Token", "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", 18),
    PresetToken("UNI", "Uniswap", "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1", 18),
    PresetToken("AAVE", "Aave Token", "0xfb6115445Bff7b52FeB98650C87f44907E58f802", 18),
]

_POLYGON: list[PresetToken] = [
    PresetToken("USDT", "Tether USD", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
    PresetToken("USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
    PresetToken("USDC.e", "Bridged USD Coin", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", 6),
    PresetToken("DAI", "Dai Stablecoin", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18),
    PresetToken("WETH", "Wrapped Ether", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18),
    PresetToken("WBTC", "Wrapped BTC", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", 8),
    PresetToken("WMATIC", "Wrapped MATIC", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 18),
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD", 18),
    PresetToken("LINK", "ChainLink Token", "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", 18),
    PresetToken("AAVE", "Aave Token", "0xD6DF932A45C0f255f85145f286eA0b292B21C90B", 18),
    PresetToken("UNI", "Uniswap", "0xb33EaAd8d922B1083446DC23f610c2567fB5180f", 18),
    PresetToken("CRV", "Curve DAO Token", "0x172370d5Cd63279eFa6d502DAB29171933a610AF", 18),
]

_ARBITRUM: list[PresetToken] = [
    PresetToken("USDT", "Tether USD", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
    PresetToken("USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
    PresetToken("USDC.e", "Bridged USD Coin", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", 6),
    PresetToken("DAI", "Dai Stablecoin", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18),
    PresetToken("WETH", "Wrapped Ether", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18),
    PresetToken("WBTC", "Wrapped BTC", "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", 8),
    PresetToken("ARB", "Arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18),
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0x5979D7B546e38E9Ab8ED1Af03400aCac5dC37e87", 18),
    PresetToken("LINK", "ChainLink Token", "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", 18),
    PresetToken("UNI", "Uniswap", "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", 18),
    PresetToken("AAVE", "Aave Token", "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", 18),
    PresetToken("GMX", "GMX", "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", 18),
    PresetToken("CRV", "Curve DAO Token", "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978", 18),
    PresetToken("PENDLE", "Pendle", "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", 18),
]

_BASE: list[PresetToken] = [
    PresetToken("USDC", "USD Coin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
    PresetToken("USDbC", "USD Base Coin", "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", 6),
    PresetToken("DAI", "Dai Stablecoin", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", 18),
    PresetToken("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
    PresetToken("cbETH", "Coinbase Wrapped Staked ETH", "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", 18),
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", 18),
    PresetToken("cbBTC", "Coinbase Wrapped BTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8),
    PresetToken("AERO", "Aerodrome", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", 18),
    PresetToken("COMP", "Compound", "0x9e1028F5F1D5eDE59748FFceE5532509976840E0", 18),
    PresetToken("CRV", "Curve DAO Token", "0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415", 18),
]

_AVALANCHE: list[PresetToken] = [
    PresetToken("USDt", "Tether USD", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6),
    PresetToken("USDC", "USD Coin", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6),
    PresetToken("DAI.e", "Dai Stablecoin", "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", 18),
    PresetToken("WAVAX", "Wrapped AVAX", "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", 18),
    PresetToken("WETH.e", "Wrapped Ether", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", 18),
    PresetToken("BTC.b", "Bitcoin (Bridged)", "0x152b9d0FdC40C096757F570A51E494bd4b943E50", 8),
    PresetToken("sAVAX", "Staked AVAX (Benqi)", "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE", 18),
    PresetToken("LINK.e", "ChainLink Token", "0x5947BB275c521040051D82396192181b413227A3", 18),
    PresetToken("JOE", "JoeToken", "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", 18),
    PresetToken("GMX", "GMX", "0x62edc0692BD897D2295872a9FFCac5425011c661", 18),
]

_FANTOM: list[PresetToken] = [
    PresetToken("fUSDT", "Frapped USDT", "0x049d68029688eAbF473097a2fC38ef61633A3C7A", 6),
    PresetToken("USDC", "USD Coin", "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", 6),
    PresetToken("DAI", "Dai Stablecoin", "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", 18),
    PresetToken("WFTM", "Wrapped Fantom", "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83", 18),
    PresetToken("WETH", "Wrapped Ether", "0x74b23882a30290451A17c44f4F05243b6b58C76d", 18),
    PresetToken("WBTC", "Wrapped BTC", "0x321162Cd933E2Be498Cd2267a90534A804051b11", 8),
]

_GNOSIS: list[PresetToken] = [
    PresetToken("USDT", "Tether USD", "0x4ECaBa5870353805a9F068101A40E0f32ed605C6", 6),
    PresetToken("USDC", "USD Coin", "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", 6),
    PresetToken("WETH", "Wrapped Ether", "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", 18),
    PresetToken("WXDAI", "Wrapped XDAI", "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", 18),
    PresetToken("GNO", "Gnosis Token", "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", 18),
    PresetToken("wstETH", "Wrapped liquid staked Ether 2.0", "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6", 18),
]


_PRESET_TOKENS: dict[int, list[PresetToken]] = {
    1: _ETHEREUM,
    10: _OPTIMISM,
    56: _BNB_CHAIN,
    137: _POLYGON,
    42161: _ARBITRUM,
    8453: _BASE,
    43114: _AVALANCHE,
    250: _FANTOM,
    100: _GNOSIS,
}
