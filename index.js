require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const { format } = require('date-fns');

const { toZonedTime } = require('date-fns-tz');
const http = require('http'); // HTTPモジュールをインポート

const simpleGit = require('simple-git');


// Discord Client 初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 設定
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const OBSIDIAN_REPO_URL = process.env.OBSIDIAN_REPO_URL;  // Obsidian Vault用リポジトリ
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const REPO_PATH = './obsidian';  // クローンしたObsidian Vaultの場所

// Git インスタンス作成
const git = simpleGit(REPO_PATH);

// Bot起動時にリポジトリ初期化
client.once('ready', async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`📋 Monitoring channel ID: ${TARGET_CHANNEL_ID}`);
    console.log(`🔧 Environment check:`);
    console.log(`- DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? 'SET' : 'NOT SET'}`);
    console.log(`- GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? 'SET' : 'NOT SET'}`);
    console.log(`- CHANNEL_ID: ${process.env.CHANNEL_ID || 'NOT SET'}`);
    console.log(`- OBSIDIAN_REPO_URL: ${process.env.OBSIDIAN_REPO_URL || 'NOT SET'}`);
    
    // Git リポジトリ初期化
    await initializeGitRepo();
});

async function initializeGitRepo() {
    try {
        const authenticatedUrl = OBSIDIAN_REPO_URL.replace(
            'https://github.com/',
            `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/`
        );

        // 既存のリポジトリフォルダを完全削除して新規クローン
        if (await fs.pathExists(REPO_PATH)) {
            console.log('🧹 Removing existing repository...');
            await fs.remove(REPO_PATH);
        }

        console.log('📥 Cloning fresh repository...');
        await simpleGit().clone(authenticatedUrl, REPO_PATH);
        
        // Git設定
        await git.addConfig('user.name', process.env.GIT_USER_NAME || 'ObsidianMemoBot');
        await git.addConfig('user.email', process.env.GIT_USER_EMAIL || 'bot@example.com');
        
        // 必要なディレクトリを作成
        await fs.ensureDir(path.join(REPO_PATH, '00_inbox'));
        
        console.log('✅ Fresh repository cloned and configured');
        
    } catch (error) {
        console.error('❌ Git initialization error:', error);
        console.log('⚠️  Falling back to local-only mode');
        
        // フォールバック: ローカルのみで動作
        await fs.ensureDir(REPO_PATH);
        await fs.ensureDir(path.join(REPO_PATH, '00_inbox'));
    }
}

// シンプルなpush関数
async function pushToGitHub(filename) {
    try {
        console.log('🔄 Pushing to GitHub...');

        // ファイルをステージング
        await git.add(path.join('00_inbox', filename));

        // コミット
        const commitMessage = `Add memo: ${filename}`;
        await git.commit(commitMessage);

        // リモートの変更を取り込んでからプッシュ（コンフリクト回避のためrebaseを試みる）
        console.log('🔄 Pulling remote changes with rebase...');
        await git.pull('origin', 'main', {'--rebase': 'true'});

        console.log('🔄 Pushing to GitHub again after pull...');
        await git.push('origin', 'main');

        console.log('✅ Successfully pushed to GitHub');
    } catch (error) {
        console.error('❌ Git push error:', error);
        console.log('📄 File saved locally but not pushed to GitHub');
        
        // プッシュが失敗してもエラーをthrowしない
        // ローカル保存は成功しているため
    }
}

// メッセージ受信時の処理
client.on('messageCreate', async (message) => {
    try {
        // Bot自身のメッセージは無視
        if (message.author.bot) return;
        
        // 指定チャンネル以外のメッセージは無視
        if (message.channel.id !== TARGET_CHANNEL_ID) return;
        
        console.log(`📨 New message from ${message.author.username}: ${message.content}`);
        
        // Obsidianメモとして保存
        await saveToObsidian(message);
        
        // 保存・プッシュ完了の通知
        await message.react('✅');
        
    } catch (error) {
        console.error('❌ Error processing message:', error);
        
        // エラーの種類に応じた処理
        if (error.message.includes('git')) {
            await message.react('🔄'); // Git関連エラー
            console.log('🔄 Git error - file saved locally but not pushed');
        } else {
            // その他のエラーの場合、ログには出力されるがDiscord上ではリアクションしない
            // (意図的に何もしない)
            console.log('ℹ️ A non-Git error occurred. The error was logged, but no reaction was sent to Discord.');
        }
    }
});

// Obsidianメモ保存関数（Git連携対応版）
async function saveToObsidian(message) {
    // フォルダパスを更新
    const inboxFolder = path.join(REPO_PATH, '00_inbox');
    await fs.ensureDir(inboxFolder);
    
    // JSTでタイムスタンプ生成
    const now = new Date();
    const jstDate = toZonedTime(now, 'Asia/Tokyo');
    const timestamp = format(jstDate, 'yyyyMMdd_HHmmss');
    const filename = `${timestamp}_discord.md`;
    const filepath = path.join(inboxFolder, filename);
    
    // Markdownコンテンツ生成
    const content = generateMarkdownContent(message);
    
    // ファイル保存
    await fs.writeFile(filepath, content, 'utf8');
    console.log(`💾 Saved to: ${filepath}`);
    
    // GitHubにプッシュ
    await pushToGitHub(filename);
}

// Markdownコンテンツ生成関数
function generateMarkdownContent(message) {
    const jstDate = toZonedTime(message.createdAt, 'Asia/Tokyo');
    const displayTimestamp = format(jstDate, 'yyyy/MM/dd HH:mm:ss');
    // const fileTimestamp = format(jstDate, 'yyyyMMdd'); // ファイル名用とは別にタイトル用タイムスタンプ

    return `# Discordメモ  
**送信者**: ${message.author.username}
**チャンネル**: ${message.channel.name}
**投稿時刻**: ${displayTimestamp}

${message.content}

---
#discord #memo
`;
}


// エラーハンドリング
client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

// Bot起動
client.login(process.env.DISCORD_TOKEN);

// Renderの無料インスタンスがスピンダウンするのを防ぐためのHTTPサーバー
const PORT = process.env.PORT || 10000; // RenderはPORT環境変数を設定します
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot is active and running.\n');
});

server.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}. This is to keep the Render service alive.`);
  console.log(`🚀 You can set up an uptime monitor to ping http://<your-render-app-url>:${PORT}/`);
});
