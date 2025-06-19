require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const { format } = require('date-fns');
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
// const OBSIDIAN_FOLDER = './obsidian/00_inbox';
const OBSIDIAN_FOLDER = './obsidian/00_inbox';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_URL = process.env.GITHUB_REPO_URL;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
// const REPO_PATH = './obsidian';
const REPO_PATH = './obsidian';

// Git インスタンス作成
const git = simpleGit(REPO_PATH);

// Bot起動時にリポジトリ初期化
client.once('ready', async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`📋 Monitoring channel ID: ${TARGET_CHANNEL_ID}`);
    
    // Git リポジトリ初期化
    await initializeGitRepo();
});

// Git リポジトリ初期化関数
async function initializeGitRepo() {
    try {
        if (!await fs.pathExists(REPO_PATH)) {
            console.log('📥 Cloning repository...');
            const authenticatedUrl = GITHUB_REPO_URL.replace(
                'https://github.com/',
                `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/`
            );
            await simpleGit().clone(authenticatedUrl, REPO_PATH);
            console.log('✅ Repository cloned successfully');
        } else {
            console.log('📂 Repository folder exists, pulling latest changes...');
            // ここで未コミットの変更があれば自動コミット
            const status = await git.status();
            if (status.files.length > 0) {
                await git.add('.');
                await git.commit('Auto-commit: save local changes before pull');
                console.log('💾 Auto-committed local changes before pull');
            }
            await git.pull('origin', 'main', {'--rebase': 'true'});
            console.log('✅ Repository updated');
        }
        await fs.ensureDir(path.join(REPO_PATH, '00_inbox'));
    } catch (error) {
        console.error('❌ Git initialization error:', error);
    }
}

// Git push 関数
async function pushToGitHub(filename) {
    try {
        console.log('🔄 Pushing to GitHub...');

        // push前にpull（rebase）してローカルを最新に
        await git.pull('origin', 'main', {'--rebase': 'true'});

        // ファイルをステージング
        await git.add(path.join('00_inbox', filename));

        // コミット
        const commitMessage = `Add memo: ${filename}`;
        await git.commit(commitMessage);

        // プッシュ
        await git.push('origin', 'main');

        console.log('✅ Successfully pushed to GitHub');

    } catch (error) {
        console.error('❌ Git push error:', error);
        throw error;
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
            await message.react('❌'); // その他のエラー
        }
    }
});

// Obsidianメモ保存関数（Git連携対応版）
async function saveToObsidian(message) {
    // フォルダパスを更新
    const inboxFolder = path.join(REPO_PATH, '00_inbox');
    await fs.ensureDir(inboxFolder);
    
    // ファイル名生成
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
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
    const timestamp = format(message.createdAt, 'yyyy/MM/dd HH:mm:ss');
    
    return `# Discord メモ - ${timestamp}

**送信者**: ${message.author.username}
**チャンネル**: ${message.channel.name}
**投稿時刻**: ${timestamp}

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
