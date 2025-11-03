import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { fileURLToPath } from 'url'
import { Telegraf, Markup } from 'telegraf'
import { TOPICS } from "./mixins/topics.js";

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { TELEGRAM_TOKEN } = process.env
if (!TELEGRAM_TOKEN) {
    process.exit(1)
}
const bot = new Telegraf(TELEGRAM_TOKEN)

const currentTopicByChat = new Map()

function chunk(arr, size) {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

function mainMenuKeyboard() {
    const titles = TOPICS.map(t => t.title)
    const rows = chunk(titles, 2)
    return Markup.keyboard(rows).resize()
}

function subMenuKeyboard() {
    return Markup.keyboard([
        ['Теорія', 'Практика'],
        ['Назад']
    ]).resize()
}

async function sendPdf(ctx, fileDef, fallbackName = 'test.pdf') {
    try {
        if (fileDef?.path) {
            const absPath = path.isAbsolute(fileDef.path)
                ? fileDef.path
                : path.join(__dirname, fileDef.path)
            if (!fs.existsSync(absPath)) {
                await ctx.reply('⚠️ Файл не знайдено.')
                return
            }
            const filename = path.basename(absPath) || fallbackName
            await ctx.replyWithDocument({ source: fs.createReadStream(absPath), filename })
            return
        }

        if (fileDef?.url) {
            const response = await axios.get(fileDef.url, { responseType: 'stream', timeout: 60000 })
            const fromUrl = new URL(fileDef.url).pathname.split('/').pop() || fallbackName
            const tmpDir = path.join(__dirname, 'tmp')
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)

            const tmpPath = path.join(tmpDir, `${Date.now()}_${fromUrl}`)
            const writer = fs.createWriteStream(tmpPath)

            await new Promise((resolve, reject) => {
                response.data.pipe(writer)
                writer.on('finish', resolve)
                writer.on('error', reject)
            })

            await ctx.replyWithDocument({ source: fs.createReadStream(tmpPath), filename: fromUrl })
            fs.unlink(tmpPath, () => {})
            return
        }

        await ctx.reply('Невірна конфігурація файлу.')
    } catch (err) {
        console.error('sendPdf error:', err?.message || err)
        await ctx.reply('Не вдалося надіслати PDF.')
    }
}

function findTopicByTitle(title) {
    return TOPICS.find(t => t.title === title) || null
}

function findTopicByKey(key) {
    return TOPICS.find(t => t.key === key) || null
}

bot.start(async ctx => {
    currentTopicByChat.delete(ctx.chat.id)
    await ctx.reply('Привіт! Обери тему:', mainMenuKeyboard())
})

bot.hears('Назад', async ctx => {
    currentTopicByChat.delete(ctx.chat.id)
    await ctx.reply('Повернувся до вибору тем:', mainMenuKeyboard())
})

bot.hears(['Теорія', 'Практика'], async ctx => {
    const chatId = ctx.chat.id
    const topicKey = currentTopicByChat.get(chatId)

    if (!topicKey) {
        await ctx.reply('Спочатку обери тему.', mainMenuKeyboard())
        return
    }

    const topic = findTopicByKey(topicKey)
    if (!topic) {
        await ctx.reply('Тема недоступна.', mainMenuKeyboard())
        currentTopicByChat.delete(chatId)
        return
    }

    const isTheory = ctx.message.text.includes('Теорія')
    const fileDef = isTheory ? topic.files.theory : topic.files.practice
    const label = isTheory ? 'Теорія' : 'Практика'
    await ctx.reply(`📄 ${label}: ${topic.title}\nНадсилаю PDF...`)
    await sendPdf(ctx, fileDef, `${topic.key}_${isTheory ? 'theory' : 'practice'}.pdf`)
})

bot.on('text', async ctx => {
    const txt = ctx.message.text?.trim()
    if (!txt) return

    const topic = findTopicByTitle(txt)

    if (topic) {
        currentTopicByChat.set(ctx.chat.id, topic.key)
        await ctx.reply(`Тема: **${topic.title}**\nОбери:`, { parse_mode: 'Markdown', ...subMenuKeyboard() })
        return
    }

    await ctx.reply('Будь ласка, обери тему з меню:', mainMenuKeyboard())
})

bot.launch().then(() => console.log('Bot start'))
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
