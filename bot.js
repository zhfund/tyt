import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import { ethers } from "ethers";
import fs from "fs";
import chalk from "chalk";
import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";

// 配置
const RPC_URL = process.env.RPC_URL || "https://dream-rpc.somnia.network";
const PING_TOKEN_ADDRESS = process.env.PING_TOKEN_ADDRESS || "0xbecd9b5f373877881d91cbdbaf013d97eb532154";
const PONG_TOKEN_ADDRESS = process.env.PONG_TOKEN_ADDRESS || "0x7968ac15a72629e05f41b8271e4e7292e0cc9f90";
const SWAP_CONTRACT_ADDRESS = process.env.SWAP_CONTRACT_ADDRESS || "0x6aac14f090a35eea150705f72d90e4cdc4a49b2c";
const PROXY = process.env.PROXY || null; // 可选代理，例如 "socks5://127.0.0.1:9050"
const NETWORK_NAME = process.env.NETWORK_NAME || "Somnia 测试网";

// ABI 定义
const swapContractABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
          { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "internalType": "struct ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  }
];

const PING_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

const PONG_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

// 日志函数
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message.includes("成功") ? chalk.green(message) :
                       message.includes("失败") || message.includes("出错") ? chalk.red(message) :
                       chalk.cyan(message);
  console.log(`${chalk.gray(timestamp)}  ${coloredMessage}`);
}

// 工具函数
function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}
function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function getTokenName(address) {
  if (address.toLowerCase() === PING_TOKEN_ADDRESS.toLowerCase()) return "Ping";
  if (address.toLowerCase() === PONG_TOKEN_ADDRESS.toLowerCase()) return "Pong";
  return address;
}

// 读取私钥文件
function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("privatekeys.txt", "utf8");
    return data.split("\n").map(key => key.trim()).filter(key => key);
  } catch (err) {
    addLog("无法读取 privatekeys.txt 文件: " + err.message);
    process.exit(1);
  }
}

// 更新钱包数据
async function updateWalletData(wallet, currentNum, total) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const balanceNative = await provider.getBalance(wallet.address);
  const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
  const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
  const pingBalance = await pingContract.balanceOf(wallet.address);
  const pongBalance = await pongContract.balanceOf(wallet.address);
  const walletInfo = {
    address: wallet.address,
    balanceNative: ethers.formatEther(balanceNative),
    balancePing: ethers.formatEther(pingBalance),
    balancePong: ethers.formatEther(pongBalance),
    network: NETWORK_NAME
  };
  addLog(`[${currentNum}/${total}] 钱包信息 - 地址: ${getShortAddress(walletInfo.address)}, 原生代币: ${walletInfo.balanceNative}, Ping: ${walletInfo.balancePing}, Pong: ${walletInfo.balancePong}, 网络: ${walletInfo.network}`);
  return walletInfo;
}

// 领取 STT 水龙头
async function claimFaucetSTT(wallet, currentNum, total) {
  try {
    const address = wallet.address;
    const axiosConfig = {
      timeout: 60000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "origin": "https://testnet.somnia.network",
        "referer": "https://testnet.somnia.network"
      }
    };
    if (PROXY) {
      const agent = new SocksProxyAgent(PROXY);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
      addLog(`[${currentNum}/${total}] 使用代理: ${PROXY}`);
    }
    addLog(`[${currentNum}/${total}] 正在为地址 ${getShortAddress(address)} 请求 STT 水龙头...`);
    const payload = { address };
    const response = await axios.post("https://testnet.somnia.network/api/faucet", payload, axiosConfig);
    if (response.status === 200) {
      addLog(`[${currentNum}/${total}] STT 水龙头领取成功！响应: ${JSON.stringify(response.data)}`);
      addLog(`[${currentNum}/${total}] 等待网络确认...`);
      await delay(10000);
    } else if (response.status === 429) {
      addLog(`[${currentNum}/${total}] 请求过于频繁或已领取`);
    } else {
      throw new Error(`意外的状态码: ${response.status}`);
    }
  } catch (error) {
    if (error.response) {
      addLog(`[${currentNum}/${total}] STT 水龙头领取失败: 状态码 ${error.response.status}，错误: ${JSON.stringify(error.response.data)}`);
    } else {
      addLog(`[${currentNum}/${total}] STT 水龙头领取失败: ${error.message}`);
    }
  }
}

// 领取 PING 水龙头
async function claimFaucetPing(wallet, currentNum, total) {
  try {
    const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, PING_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog(`[${currentNum}/${total}] 正在请求 PING 水龙头...`);
    const tx = await pingContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`[${currentNum}/${total}] 交易已发送。交易哈希: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog(`[${currentNum}/${total}] PING 水龙头领取成功！`);
    await delay(5000);
  } catch (error) {
    addLog(`[${currentNum}/${total}] PING 水龙头领取失败: ${error.message}`);
  }
}

// 领取 PONG 水龙头
async function claimFaucetPong(wallet, currentNum, total) {
  try {
    const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, PONG_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog(`[${currentNum}/${total}] 正在请求 PONG 水龙头...`);
    const tx = await pongContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`[${currentNum}/${total}] 交易已发送。交易哈希: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog(`[${currentNum}/${total}] PONG 水龙头领取成功！`);
    await delay(5000);
  } catch (error) {
    addLog(`[${currentNum}/${total}] PONG 水龙头领取失败: ${error.message}`);
  }
}

// 检查并授权代币
async function checkAndApproveToken(wallet, tokenAddress, spender, amount, currentNum, total) {
  const erc20ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, wallet);
  const currentAllowance = await tokenContract.allowance(wallet.address, spender);
  if (currentAllowance < amount) {
    addLog(`[${currentNum}/${total}] 需要为代币 ${getShortAddress(tokenAddress)} 授权。当前授权额度: ${ethers.formatEther(currentAllowance)}`);
    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const tx = await tokenContract.approve(spender, maxApproval);
    addLog(`[${currentNum}/${total}] 授权交易已发送: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog(`[${currentNum}/${total}] 授权成功。`);
  } else {
    addLog(`[${currentNum}/${total}] 代币已授权。`);
  }
}

// 自动交换
async function autoSwapPingPong(wallet, totalSwaps, currentNum, total) {
  try {
    const swapContract = new ethers.Contract(SWAP_CONTRACT_ADDRESS, swapContractABI, wallet);
    const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, PING_ABI, wallet);
    const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, PONG_ABI, wallet);
    addLog(`[${currentNum}/${total}] 开始自动交换 ${totalSwaps} 次。`);
    for (let i = 0; i < totalSwaps; i++) {
      const pingBalance = await pingContract.balanceOf(wallet.address);
      const pongBalance = await pongContract.balanceOf(wallet.address);
      const minAmount = ethers.parseUnits("100", 18);
      let tokenIn, tokenOut, direction;
      if (pingBalance >= minAmount && pongBalance >= minAmount) {
        direction = Math.random() < 0.5 ? "PongToPing" : "PingToPong";
      } else if (pingBalance < minAmount && pongBalance >= minAmount) {
        direction = "PongToPing";
      } else if (pongBalance < minAmount && pingBalance >= minAmount) {
        direction = "PingToPong";
      } else {
        addLog(`[${currentNum}/${total}] Ping 和 Pong 余额均不足，无法继续交换。`);
        break;
      }
      tokenIn = direction === "PongToPing" ? PONG_TOKEN_ADDRESS : PING_TOKEN_ADDRESS;
      tokenOut = direction === "PongToPing" ? PING_TOKEN_ADDRESS : PONG_TOKEN_ADDRESS;
      const randomAmount = randomInRange(100, 500);
      const amountIn = ethers.parseUnits(randomAmount.toString(), 18);
      const tokenInName = getTokenName(tokenIn);
      const tokenOutName = getTokenName(tokenOut);
      addLog(`[${currentNum}/${total}] 交换 ${i + 1}/${totalSwaps}: 从 ${tokenInName} 到 ${tokenOutName}，数量 ${randomAmount}`);
      await checkAndApproveToken(wallet, tokenIn, SWAP_CONTRACT_ADDRESS, amountIn, currentNum, total);
      const tx = await swapContract.exactInputSingle({
        tokenIn,
        tokenOut,
        fee: 500,
        recipient: wallet.address,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0n
      });
      addLog(`[${currentNum}/${total}] 交换 ${i + 1}/${totalSwaps} 交易已发送: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog(`[${currentNum}/${total}] 交换 ${i + 1}/${totalSwaps} 成功。`);
      await updateWalletData(wallet, currentNum, total);
      if (i < totalSwaps - 1) {
        const delayMs = randomInRange(2000, 5000);
        addLog(`[${currentNum}/${total}] 等待 ${delayMs / 1000} 秒后进行下一次交换...`);
        await delay(delayMs);
      }
    }
    addLog(`[${currentNum}/${total}] 自动交换完成。`);
  } catch (err) {
    addLog(`[${currentNum}/${total}] 自动交换出错: ${err.message}`);
  }
}

// 处理单个钱包的操作
async function processWallet(privateKey, index, total) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  let pk = privateKey.trim();
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  const wallet = new ethers.Wallet(pk, provider);

  // 更新钱包信息
  await updateWalletData(wallet, index, total);

  // 领取水龙头
  await claimFaucetSTT(wallet, index, total);
  await claimFaucetPing(wallet, index, total);
  await claimFaucetPong(wallet, index, total);

  // 更新钱包信息（确保水龙头领取后的余额更新）
  await updateWalletData(wallet, index, total);

  // 执行自动交换（例如 5 次）
  await autoSwapPingPong(wallet, 5, index, total);

  // 钱包处理完成后等待 2 秒
  addLog(`[${index}/${total}] 钱包处理完成，等待 2 秒后处理下一个...`);
  await delay(2000); // Changed from 10000 (10 seconds) to 2000 (2 seconds)
}

// 主函数：批量处理所有钱包
async function startBatch() {
  console.log(chalk.bold.green("=================== SOMNIA AUTO SWAP BATCH MODE ==================="));
  console.log(chalk.yellow("关注X：https://x.com/qklxsqf 获得更多资讯："));
  console.log(chalk.green("============================================================"));

  // 加载私钥
  const privateKeys = loadPrivateKeys();
  const totalWallets = privateKeys.length;
  addLog(`检测到 ${totalWallets} 个钱包。`);

  // 循环处理每个钱包
  for (let i = 0; i < totalWallets; i++) {
    await processWallet(privateKeys[i], i + 1, totalWallets);
  }

  addLog("所有钱包批量操作完成！");
}

// 启动批量模式
startBatch().catch(err => {
  addLog("程序出错: " + err.message);
  process.exit(1);
});