require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;


/*
========================================
ENVIRONMENT VARIABLES
========================================
*/

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_KEY =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const JWT_SECRET =
    process.env.JWT_SECRET;


/*
========================================
TELEGRAM
========================================
*/

const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

/*
Separate bot used ONLY for the Mini App
(auth.html). This can be a completely
different bot from the one above — the
one above sends admin notifications and
deposit/withdrawal approvals; this one is
whichever bot the user opens the Web App
from. They are unrelated to each other;
Telegram signs initData with whichever
bot's token owns the Mini App button the
user tapped.
*/

const TELEGRAM_WEBAPP_BOT_TOKEN =
    process.env.TELEGRAM_WEBAPP_BOT_TOKEN ||
    TELEGRAM_BOT_TOKEN;

const TELEGRAM_ADMIN_CHAT_ID =
    process.env.TELEGRAM_ADMIN_CHAT_ID;

const TELEGRAM_ADMIN_USER_ID =
    process.env.TELEGRAM_ADMIN_USER_ID;

const TELEGRAM_WEBHOOK_URL =
    process.env.TELEGRAM_WEBHOOK_URL;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;


/*
========================================
REQUIRED ENV CHECK
========================================
*/

if (
    !SUPABASE_URL ||
    !SUPABASE_KEY ||
    !JWT_SECRET
) {
    console.error("");
    console.error("================================");
    console.error("MISSING ENVIRONMENT VARIABLES");
    console.error("================================");
    console.error("");
    console.error("Required:");
    console.error("SUPABASE_URL");
    console.error(
        "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"
    );
    console.error("JWT_SECRET");
    console.error("");

    process.exit(1);
}


/*
========================================
TELEGRAM CONFIGURATION
========================================
*/

const telegramEnabled =
    Boolean(
        TELEGRAM_BOT_TOKEN &&
        TELEGRAM_ADMIN_CHAT_ID
    );


if (!telegramEnabled) {

    console.warn("");
    console.warn(
        "WARNING: Telegram deposit verification is not configured."
    );
    console.warn(
        "Add TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to .env"
    );
    console.warn("");

}

if (!process.env.TELEGRAM_WEBAPP_BOT_TOKEN) {

    console.warn("");
    console.warn(
        "WARNING: TELEGRAM_WEBAPP_BOT_TOKEN is not set."
    );
    console.warn(
        "Falling back to TELEGRAM_BOT_TOKEN for Mini App login verification."
    );
    console.warn(
        "If your Web App button lives on a DIFFERENT bot, set " +
        "TELEGRAM_WEBAPP_BOT_TOKEN to that bot's token or every login will fail."
    );
    console.warn("");

} else {

    if (!TELEGRAM_ADMIN_USER_ID) {

        console.warn("");
        console.warn(
            "WARNING: TELEGRAM_ADMIN_USER_ID is missing."
        );
        console.warn(
            "Accept/Reject buttons will not work."
        );
        console.warn("");

    }

}


/*
========================================
SUPABASE
========================================
*/

const supabase =
    createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );


/*
========================================
EARNING PLANS CATALOG
========================================

This is the SERVER-SIDE source of truth
for plan pricing.

The client (plans.html) only sends the
plan NAME. We never trust amounts sent
from the browser — they are looked up
here so a tampered request can't
activate a plan for the wrong price.

Keep this in sync with plans.html.
========================================
*/

const EARNING_PLANS = {

    Starter: {
        amount: 3000,
        daily: 1000,
        total: 30000,
        durationDays: 30
    },

    Basic: {
        amount: 5000,
        daily: 1800,
        total: 54000,
        durationDays: 30
    },

    Growth: {
        amount: 10000,
        daily: 4000,
        total: 120000,
        durationDays: 30
    },

    Pro: {
        amount: 25000,
        daily: 11000,
        total: 330000,
        durationDays: 30
    },

    Elite: {
        amount: 50000,
        daily: 24000,
        total: 720000,
        durationDays: 30
    },

    Premium: {
        amount: 100000,
        daily: 52000,
        total: 1560000,
        durationDays: 30
    },

    VIP: {
        amount: 250000,
        daily: 140000,
        total: 4200000,
        durationDays: 30
    },

    Ultimate: {
        amount: 500000,
        daily: 300000,
        total: 9000000,
        durationDays: 30
    }

};


/*
========================================
REFERRALS
========================================

A user's own USERNAME doubles as their
referral code, so there's nothing extra
to generate or look up.

The link now points at the Telegram Mini
App itself (not the website), using
Telegram's own deep-link parameter:

    https://t.me/<bot>/<shortname>?startapp=<username>

Telegram passes whatever comes after
startapp= straight through into
initData as start_param, which
auth.html reads and forwards as `ref`
when it calls /api/auth/telegram.

Whoever opens the app with a valid
start_param gets tied to that referrer,
and the referrer is credited
REFERRAL_BONUS once, at the moment the
new account is created.
========================================
*/

const APP_BASE_URL =
    process.env.APP_BASE_URL ||
    "https://netnaira.onrender.com";

/*
The bot username and Mini App short name
you set up in BotFather's /newapp flow —
e.g. for https://t.me/netnairapaybot/Netnaira
these are "netnairapaybot" and "Netnaira".
*/

const TELEGRAM_WEBAPP_BOT_USERNAME =
    process.env.TELEGRAM_WEBAPP_BOT_USERNAME ||
    "netnairapaybot";

const TELEGRAM_WEBAPP_SHORT_NAME =
    process.env.TELEGRAM_WEBAPP_SHORT_NAME ||
    "Netnaira";

const REFERRAL_BONUS = 500;

/*
========================================
WELCOME BONUS
========================================

Every brand-new account is credited this
amount, straight into their spendable
balance, the moment their row is created.

Paired with the `welcome_bonus_shown`
column on `users` — the dashboard reads
that flag to decide whether to pop up the
"you've been credited" + "join Telegram"
modals, then calls
POST /api/user/ack-welcome-bonus to flip
it to true so it never shows again.
========================================
*/

const WELCOME_BONUS = 500;

/*
Referral earnings land in referral_balance, not the
main balance. A user must move it across manually,
subject to both rules below (also enforced inside the
withdraw_referral_balance() Postgres function, which is
the actual source of truth — these are just used for
early, friendly validation before we hit the DB).
*/

const MIN_REFERRAL_WITHDRAWAL = 2000;

/*
========================================
BANK WITHDRAWALS
========================================

Normal balance withdrawals are handled as
requests first. The user's balance is only
deducted when an authorized Telegram admin
approves the request through the button.

This prevents accidental balance loss when
a request is rejected.
========================================
*/

const MIN_WITHDRAWAL = 2500;
const MIN_WITHDRAWAL_REFERRALS = 5;

const NIGERIAN_BANKS = [
    "Access Bank",
    "Citibank Nigeria",
    "Ecobank Nigeria",
    "Fidelity Bank",
    "First Bank of Nigeria",
    "First City Monument Bank (FCMB)",
    "Globus Bank",
    "Guaranty Trust Bank (GTBank)",
    "Heritage Bank",
    "Keystone Bank",
    "Polaris Bank",
    "Providus Bank",
    "Stanbic IBTC Bank",
    "Standard Chartered Bank",
    "Sterling Bank",
    "SunTrust Bank",
    "Titan Trust Bank",
    "Union Bank of Nigeria",
    "United Bank for Africa (UBA)",
    "Unity Bank",
    "Wema Bank",
    "Zenith Bank",
    "Jaiz Bank",
    "TAJ Bank",
    "Lotus Bank",
    "Parallex Bank",
    "Premium Trust Bank",
    "Signature Bank",
    "Optimus Bank",
    "PalmPay",
    "Opay (Paycom)",
    "Kuda Bank",
    "Moniepoint MFB",
    "VFD Microfinance Bank",
    "Sparkle Microfinance Bank",
    "Rubies Microfinance Bank",
    "Mint Finex MFB",
    "Carbon (One Finance)",
    "FairMoney Microfinance Bank",
    "Eyowo",
    "9Payment Service Bank (9PSB)",
    "Rand Merchant Bank",
    "FSDH Merchant Bank",
    "Nova Merchant Bank",
    "Coronation Merchant Bank",
    "Greenwich Merchant Bank",
    "Ekondo Microfinance Bank",
    "Sahel Sahara Bank",
    "NPF Microfinance Bank",
    "AB Microfinance Bank",
    "Baobab Microfinance Bank",
    "Hasal Microfinance Bank",
    "Corestep MFB",
    "Petra Microfinance Bank",
    "Bowen Microfinance Bank",
    "Fina Trust Microfinance Bank",
    "Mutual Trust Microfinance Bank"
];




/*
========================================
DAILY EARNINGS SWEEP
========================================

Calls the process_daily_earnings() Postgres
function, which credits every active plan
that hasn't been paid for "today" yet.

It is safe to call this often — it is a
no-op for any plan already credited today,
and it CATCHES UP any days that were missed
(e.g. the server was asleep/restarted on a
free hosting tier) by crediting however many
days have actually elapsed since the last
credit, capped at the plan's remaining days.

Because of that, we don't need a precise
midnight scheduler: running this on an
interval (plus once at startup) is enough
for every plan to keep paying out daily.
========================================
*/

async function runDailyEarningsSweep() {

    try {

        const {
            data,
            error
        } = await supabase
            .rpc(
                "process_daily_earnings"
            );


        if (error) {

            console.error(
                "Daily earnings sweep error:",
                error
            );

            return;

        }


        if (
            data &&
            data.credited_count
        ) {

            console.log(
                `Daily earnings sweep: credited ${data.credited_count} plan(s).`
            );

        }


    } catch (error) {

        console.error(
            "Daily earnings sweep failed:",
            error
        );

    }

}


/*
========================================
MULTER
========================================

Screenshots stay in RAM temporarily.

They are:
- NOT saved to disk
- NOT uploaded to Supabase Storage
- Sent directly to Telegram

Maximum:
5 MB
========================================
*/

const upload =
    multer({

        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                5 * 1024 * 1024
        },

        fileFilter:
            (req, file, cb) => {

                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                ];

                if (
                    allowedTypes.includes(
                        file.mimetype
                    )
                ) {

                    cb(
                        null,
                        true
                    );

                } else {

                    cb(
                        new Error(
                            "Only JPG, PNG and WEBP images are allowed."
                        )
                    );

                }

            }

    });


/*
========================================
MIDDLEWARE
========================================
*/

app.use(
    express.json()
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    cookieParser()
);


/*
========================================
HEALTH / WAKE-UP PING
========================================

Two purposes:

1. Pages that are about to do something
   heavy (like the deposit screenshot
   upload) hit this the moment they load,
   as early as possible, to start waking
   a sleeping Render free-tier instance
   well before the user finishes filling
   the form.

2. An external uptime pinger (UptimeRobot,
   cron-job.org, etc.) can hit this every
   10-14 minutes to stop the instance from
   spinning down at all during business
   hours. No auth, no DB call, so it's
   nearly instant even on a cold path.
========================================
*/

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,
            status: "awake"
        });

    }
);


/*
========================================
AUTHENTICATION
========================================
*/

function authenticate(
    req,
    res,
    next
) {

    const token =
        req.cookies.netnaira_session;

    if (!token) {

        return res.status(401).json({
            success: false,
            message:
                "You are not logged in."
        });

    }

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        if (!decoded.userId) {

            return res.status(401).json({
                success: false,
                message:
                    "Invalid session."
            });

        }

        req.userId =
            decoded.userId;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message:
                "Your session has expired. Please log in again."
        });

    }

}


/*
========================================
TELEGRAM API HELPER
========================================
*/

async function telegramApi(
    method,
    body,
    botToken
) {

    const token =
        botToken ||
        TELEGRAM_BOT_TOKEN;

    if (!token) {

        throw new Error(
            "TELEGRAM_BOT_TOKEN is missing."
        );

    }

    const url =
        `https://api.telegram.org/bot${token}/${method}`;

    const response =
        await fetch(
            url,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(body)
            }
        );

    const data =
        await response
            .json()
            .catch(
                () => null
            );

    if (
        !response.ok ||
        !data ||
        !data.ok
    ) {

        const errorMessage =
            data?.description ||
            `Telegram API request failed with HTTP ${response.status}`;

        throw new Error(
            errorMessage
        );

    }

    return data.result;
}


/*
========================================
TELEGRAM DEPOSIT MESSAGE UPDATE
========================================
*/

async function updateTelegramDepositMessage(
    callbackQuery,
    statusText
) {

    try {

        const message =
            callbackQuery.message;

        if (!message) {
            return;
        }

        const originalCaption =
            message.caption ||
            "Deposit verification";

        /*
        Avoid adding the status multiple times.
        */

        let baseCaption =
            originalCaption;

        const separatorIndex =
            baseCaption.indexOf(
                "\n━━━━━━━━━━━━━━━━━━\n\n"
            );

        if (
            separatorIndex !== -1
        ) {

            baseCaption =
                baseCaption.substring(
                    0,
                    separatorIndex
                );

        }

        const finalCaption =
            `${baseCaption}

━━━━━━━━━━━━━━━━━━

${statusText}`;

        await telegramApi(
            "editMessageCaption",
            {
                chat_id:
                    message.chat.id,

                message_id:
                    message.message_id,

                caption:
                    finalCaption.slice(
                        0,
                        1024
                    ),

                reply_markup: {
                    inline_keyboard: []
                }
            }
        );

    } catch (error) {

        console.error(
            "Telegram message update error:",
            error.message
        );

    }

}



/*
========================================
TELEGRAM WITHDRAWAL MESSAGE UPDATE
========================================
*/

async function updateTelegramWithdrawalMessage(
    callbackQuery,
    statusText
) {

    try {

        const message =
            callbackQuery.message;

        if (!message) {
            return;
        }

        const originalText =
            message.text ||
            "Withdrawal request";

        const separator =
            "\n━━━━━━━━━━━━━━━━━━\n\n";

        let baseText =
            originalText;

        const separatorIndex =
            baseText.indexOf(separator);

        if (separatorIndex !== -1) {
            baseText =
                baseText.substring(
                    0,
                    separatorIndex
                );
        }

        await telegramApi(
            "editMessageText",
            {
                chat_id:
                    message.chat.id,

                message_id:
                    message.message_id,

                text:
                    `${baseText}${separator}${statusText}`.slice(
                        0,
                        4096
                    ),

                reply_markup: {
                    inline_keyboard: []
                }
            }
        );

    } catch (error) {

        console.error(
            "Withdrawal Telegram message update error:",
            error.message
        );

    }

}


/*
========================================
TELEGRAM WITHDRAWAL CALLBACK
========================================
*/

async function handleTelegramWithdrawalCallback(
    callbackQuery
) {

    const callbackData =
        callbackQuery?.data || "";

    const match =
        callbackData.match(
            /^withdrawal:(approve|reject):([0-9a-f-]{36})$/i
        );

    if (!match) {
        return false;
    }

    const action =
        match[1].toLowerCase();

    const withdrawalId =
        match[2];

    const adminUserId =
        String(
            callbackQuery.from?.id || ""
        );

    const adminChatId =
        String(
            callbackQuery.message?.chat?.id || ""
        );

    if (
        !TELEGRAM_ADMIN_USER_ID ||
        adminUserId !==
            String(TELEGRAM_ADMIN_USER_ID)
    ) {

        await telegramApi(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,

                text:
                    "⛔ You are not authorized to manage withdrawals.",

                show_alert:
                    true
            }
        ).catch(() => {});

        return true;
    }

    if (
        adminChatId !==
        String(TELEGRAM_ADMIN_CHAT_ID)
    ) {

        await telegramApi(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,

                text:
                    "⛔ Unauthorized chat.",

                show_alert:
                    true
            }
        ).catch(() => {});

        return true;
    }

    try {

        const rpcName =
            action === "approve"
                ? "approve_withdrawal"
                : "reject_withdrawal";

        const {
            data,
            error
        } = await supabase
            .rpc(
                rpcName,
                {
                    p_withdrawal_id:
                        withdrawalId,

                    p_reviewer:
                        adminUserId
                }
            );

        if (error) {

            console.error(
                `${rpcName} RPC error:`,
                error
            );

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "⚠️ Action failed. Check server logs.",

                    show_alert:
                        true
                }
            ).catch(() => {});

            return true;
        }

        if (
            !data ||
            data.success !== true
        ) {

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        data?.message ||
                        "This withdrawal has already been processed.",

                    show_alert:
                        true
                }
            ).catch(() => {});

            if (
                data?.message ===
                    "This withdrawal has already been processed."
            ) {

                await updateTelegramWithdrawalMessage(
                    callbackQuery,
                    `⚠️ ALREADY PROCESSED

Current status: ${data.status || "unknown"}`
                );

            }

            return true;
        }

        const amount =
            Number(data.amount || 0);

        if (action === "approve") {

            const newBalance =
                Number(data.new_balance || 0);

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "✅ Withdrawal approved."
                }
            ).catch(() => {});

            await updateTelegramWithdrawalMessage(
                callbackQuery,
                `✅ APPROVED BY ADMIN

💸 Paid:
₦${amount.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

💳 User balance:
₦${newBalance.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}`
            );

            console.log(
                `Withdrawal approved: ${withdrawalId} | ₦${amount}`
            );

        } else {

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "❌ Withdrawal rejected."
                }
            ).catch(() => {});

            await updateTelegramWithdrawalMessage(
                callbackQuery,
                `❌ REJECTED BY ADMIN

💸 Amount:
₦${amount.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

💳 User balance was not changed.`
            );

            console.log(
                `Withdrawal rejected: ${withdrawalId}`
            );

        }

    } catch (error) {

        console.error(
            "Withdrawal callback error:",
            error
        );

        await telegramApi(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,

                text:
                    "⚠️ Unable to process this withdrawal.",

                show_alert:
                    true
            }
        ).catch(() => {});

    }

    return true;
}


/*
========================================
TELEGRAM ADMIN BROADCAST MESSAGE
========================================

Lets the admin send a message to every user
of the bot directly from inside the admin's
Telegram chat, triggered with /broadcast.

Two ways to use it:
1. Inline:  "/broadcast Maintenance at 12am"
   -> sent immediately.
2. Two-step: send "/broadcast" on its own, the
   bot asks for the message, then whatever you
   send next (as long as it's not itself a
   command) is what gets broadcast.

Security: only the authorized admin user/chat
- the same ones the deposit/withdrawal approval
buttons already trust - can trigger this.
Everyone else is silently ignored.

The message is sent as a real Telegram
message from the MAIN bot (TELEGRAM_WEBAPP_BOT_TOKEN
- whichever bot the user opened the Mini App
from) to every user who has a telegram_id on
file, one DM per user. This is not an in-app
popup/notification - it lands directly in the
user's chat with the bot, same as any other
message from it.

Users who have blocked the bot or never
started a chat with it will fail silently
(Telegram returns 403 for those) - we just
skip them and keep going.
========================================
*/

let awaitingBroadcastMessage =
    false;

const BROADCAST_BATCH_SIZE =
    25;

const BROADCAST_BATCH_DELAY_MS =
    1000;

function sleep(ms) {

    return new Promise(
        (resolve) => setTimeout(resolve, ms)
    );

}

async function sendBroadcastMessage(
    text,
    chatId
) {

    try {

        const {
            data: users,
            error
        } = await supabase
            .from("users")
            .select("telegram_id")
            .not("telegram_id", "is", null);

        if (error) {

            console.error(
                "Broadcast recipients fetch error:",
                error
            );

            await telegramApi(
                "sendMessage",
                {
                    chat_id:
                        chatId,

                    text:
                        "⚠️ Could not load the user list. Please try again."
                }
            ).catch(() => {});

            return;

        }

        const recipients =
            (users || [])
                .map((user) => user.telegram_id)
                .filter(Boolean);

        if (!recipients.length) {

            await telegramApi(
                "sendMessage",
                {
                    chat_id:
                        chatId,

                    text:
                        "⚠️ No users to broadcast to."
                }
            ).catch(() => {});

            return;

        }

        let sent = 0;
        let failed = 0;

        for (
            let i = 0;
            i < recipients.length;
            i += BROADCAST_BATCH_SIZE
        ) {

            const batch =
                recipients.slice(
                    i,
                    i + BROADCAST_BATCH_SIZE
                );

            const results =
                await Promise.allSettled(
                    batch.map(
                        (telegramId) =>
                            telegramApi(
                                "sendMessage",
                                {
                                    chat_id:
                                        telegramId,

                                    text
                                },
                                TELEGRAM_WEBAPP_BOT_TOKEN
                            )
                    )
                );

            for (const result of results) {

                if (result.status === "fulfilled") {
                    sent += 1;
                } else {
                    failed += 1;
                }

            }

            if (i + BROADCAST_BATCH_SIZE < recipients.length) {
                await sleep(BROADCAST_BATCH_DELAY_MS);
            }

        }

        await telegramApi(
            "sendMessage",
            {
                chat_id:
                    chatId,

                text:
                    `✅ Broadcast sent to ${sent} user(s).` +
                    (failed ? ` (${failed} could not be reached.)` : "")
            }
        ).catch(() => {});

    } catch (error) {

        console.error(
            "Admin broadcast error:",
            error
        );

        await telegramApi(
            "sendMessage",
            {
                chat_id:
                    chatId,

                text:
                    "⚠️ Could not send that broadcast. Please try again."
            }
        ).catch(() => {});

    }

}


async function handleTelegramAdminMessage(
    message
) {

    if (!message) {
        return;
    }

    const senderUserId =
        String(
            message.from?.id || ""
        );

    const senderChatId =
        String(
            message.chat?.id || ""
        );

    if (
        !TELEGRAM_ADMIN_USER_ID ||
        senderUserId !==
            String(
                TELEGRAM_ADMIN_USER_ID
            ) ||
        senderChatId !==
            String(
                TELEGRAM_ADMIN_CHAT_ID
            )
    ) {

        /*
        Silently ignore. This chat also
        receives deposit/withdrawal button
        messages, so unrelated senders are
        expected here and shouldn't get a
        reply.
        */

        return;

    }

    const text =
        (message.text || "").trim();

    if (!text) {
        return;
    }

    /*
    ========================================
    "/broadcast <message>" - INLINE
    ========================================
    */

    if (
        /^\/broadcast(@\S+)?(\s+|$)/i.test(
            text
        )
    ) {

        const inlineMessage =
            text
                .replace(
                    /^\/broadcast(@\S+)?\s*/i,
                    ""
                )
                .trim();

        if (inlineMessage) {

            awaitingBroadcastMessage =
                false;

            await sendBroadcastMessage(
                inlineMessage,
                senderChatId
            );

            return;

        }

        /*
        "/broadcast" with nothing after it -
        switch to two-step mode and wait for
        the next message.
        */

        awaitingBroadcastMessage =
            true;

        await telegramApi(
            "sendMessage",
            {
                chat_id:
                    senderChatId,

                text:
                    "📝 Send the message you want to broadcast to all users."
            }
        ).catch(() => {});

        return;

    }

    /*
    ========================================
    ANY OTHER SLASH COMMAND
    ========================================
    */

    if (text.startsWith("/")) {

        awaitingBroadcastMessage =
            false;

        return;

    }

    /*
    ========================================
    "/broadcast" - STEP 2 (the message itself)
    ========================================
    */

    if (awaitingBroadcastMessage) {

        awaitingBroadcastMessage =
            false;

        await sendBroadcastMessage(
            text,
            senderChatId
        );

    }

    /*
    A plain message sent without first typing
    /broadcast is not treated as a notification
    - it's just ignored.
    */

}


/*
========================================
TELEGRAM CALLBACK HANDLER
========================================
*/

async function handleTelegramCallback(
    callbackQuery
) {

    if (!callbackQuery) {
        return;
    }

    const callbackData =
        callbackQuery.data ||
        "";

    if (
        await handleTelegramWithdrawalCallback(
            callbackQuery
        )
    ) {
        return;
    }

    const match =
        callbackData.match(
            /^deposit:(approve|reject):([0-9a-f-]{36})$/i
        );

    if (!match) {

        try {

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "Unknown action."
                }
            );

        } catch (error) {

            console.error(
                "Callback answer error:",
                error.message
            );

        }

        return;
    }

    const action =
        match[1].toLowerCase();

    const depositId =
        match[2];

    const adminUserId =
        String(
            callbackQuery.from?.id || ""
        );

    const adminChatId =
        String(
            callbackQuery.message?.chat?.id || ""
        );


    /*
    ========================================
    SECURITY CHECK
    ========================================
    */

    if (
        !TELEGRAM_ADMIN_USER_ID ||
        adminUserId !==
            String(
                TELEGRAM_ADMIN_USER_ID
            )
    ) {

        try {

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "⛔ You are not authorized to approve deposits.",

                    show_alert:
                        true
                }
            );

        } catch (error) {

            console.error(
                "Unauthorized callback error:",
                error.message
            );

        }

        console.warn(
            "Unauthorized Telegram callback attempt from user:",
            adminUserId
        );

        return;
    }


    /*
    ========================================
    CHAT SECURITY CHECK
    ========================================
    */

    if (
        adminChatId !==
        String(
            TELEGRAM_ADMIN_CHAT_ID
        )
    ) {

        try {

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "⛔ Unauthorized chat.",

                    show_alert:
                        true
                }
            );

        } catch (error) {

            console.error(
                "Unauthorized chat callback error:",
                error.message
            );

        }

        return;
    }


    /*
    ========================================
    APPROVE
    ========================================
    */

    if (
        action ===
        "approve"
    ) {

        try {

            const {
                data,
                error
            } = await supabase
                .rpc(
                    "approve_deposit",
                    {
                        p_deposit_id:
                            depositId,

                        p_reviewer:
                            adminUserId
                    }
                );


            if (error) {

                console.error(
                    "Approve deposit RPC error:",
                    error
                );

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            "⚠️ Approval failed. Check server logs.",

                        show_alert:
                            true
                    }
                );

                return;
            }


            /*
            The function returns a single
            JSON object (not rows), e.g.
            { success, message, amount, user_id }
            */

            if (
                !data ||
                data.success !== true
            ) {

                const failureMessage =
                    (data && data.message) ||
                    "This deposit could not be approved.";

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            failureMessage,

                        show_alert:
                            true
                    }
                );

                if (
                    data &&
                    data.message ===
                        "This deposit has already been processed."
                ) {

                    await updateTelegramDepositMessage(
                        callbackQuery,
                        `⚠️ ALREADY PROCESSED\n\nCurrent status: ${data.status || "unknown"}\n\nNo additional balance was credited.`
                    );

                }

                return;
            }


            const approvedAmount =
                Number(
                    data.amount || 0
                );

            /*
            approve_deposit does not return
            the updated balance, so fetch it
            separately for the Telegram message.
            */

            const {
                data: userRow,
                error: userRowError
            } = await supabase
                .from("users")
                .select("balance")
                .eq(
                    "id",
                    data.user_id
                )
                .maybeSingle();

            if (userRowError) {

                console.error(
                    "Fetch updated balance error:",
                    userRowError
                );

            }

            const newBalance =
                Number(
                    userRow?.balance || 0
                );


            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "✅ Deposit approved."
                }
            );


            await updateTelegramDepositMessage(
                callbackQuery,

                `✅ APPROVED BY ADMIN

💰 Credited:
₦${approvedAmount.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

💳 New user balance:
₦${newBalance.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}`
            );


            console.log(
                `Deposit approved: ${depositId} | ₦${approvedAmount}`
            );

        } catch (error) {

            console.error(
                "Approve deposit error:",
                error
            );

            try {

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            "⚠️ Approval failed. No balance change was made.",

                        show_alert:
                            true
                    }
                );

            } catch (answerError) {

                console.error(
                    "Telegram callback error:",
                    answerError.message
                );

            }

        }

        return;
    }


    /*
    ========================================
    REJECT
    ========================================
    */

    if (
        action ===
        "reject"
    ) {

        try {

            /*
            reject_deposit does not return
            the deposit amount, so fetch it
            separately for the Telegram message.
            This is display-only; the RPC below
            still does the actual status check
            and update under its own row lock.
            */

            const {
                data: depositRow,
                error: depositLookupError
            } = await supabase
                .from("deposit_requests")
                .select("amount")
                .eq(
                    "id",
                    depositId
                )
                .maybeSingle();

            if (depositLookupError) {

                console.error(
                    "Reject deposit lookup error:",
                    depositLookupError
                );

            }


            const {
                data,
                error
            } = await supabase
                .rpc(
                    "reject_deposit",
                    {
                        p_deposit_id:
                            depositId,

                        p_reviewer:
                            adminUserId
                    }
                );


            if (error) {

                console.error(
                    "Reject deposit RPC error:",
                    error
                );

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            "⚠️ Rejection failed. Check server logs.",

                        show_alert:
                            true
                    }
                );

                return;
            }


            /*
            The function returns a single
            JSON object (not rows), e.g.
            { success, message }
            */

            if (
                !data ||
                data.success !== true
            ) {

                const failureMessage =
                    (data && data.message) ||
                    "This deposit could not be rejected.";

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            failureMessage,

                        show_alert:
                            true
                    }
                );

                if (
                    data &&
                    data.message ===
                        "This deposit has already been processed."
                ) {

                    await updateTelegramDepositMessage(
                        callbackQuery,
                        `⚠️ ALREADY PROCESSED\n\nCurrent status: ${data.status || "unknown"}\n\nNo balance change was made.`
                    );

                }

                return;
            }


            const rejectedAmount =
                Number(
                    depositRow?.amount || 0
                );


            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,

                    text:
                        "❌ Deposit rejected."
                }
            );


            await updateTelegramDepositMessage(
                callbackQuery,

                `❌ REJECTED BY ADMIN

💰 Amount:
₦${rejectedAmount.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

💳 User balance was NOT credited.`
            );


            console.log(
                `Deposit rejected: ${depositId}`
            );

        } catch (error) {

            console.error(
                "Reject deposit error:",
                error
            );

            try {

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,

                        text:
                            "⚠️ Rejection failed.",

                        show_alert:
                            true
                    }
                );

            } catch (answerError) {

                console.error(
                    "Telegram callback answer error:",
                    answerError.message
                );

            }

        }

    }

}


/*
========================================
TELEGRAM WEBHOOK
========================================
*/

app.post(
    "/api/telegram/webhook",
    async (req, res) => {

        if (
            !TELEGRAM_WEBHOOK_SECRET ||
            req.get(
                "X-Telegram-Bot-Api-Secret-Token"
            ) !==
                TELEGRAM_WEBHOOK_SECRET
        ) {

            return res.sendStatus(401);

        }

        try {

            if (
                req.body &&
                req.body.callback_query
            ) {

                await handleTelegramCallback(
                    req.body.callback_query
                );

            }

            if (
                req.body &&
                req.body.message
            ) {

                await handleTelegramAdminMessage(
                    req.body.message
                );

            }

        } catch (error) {

            console.error(
                "Telegram webhook error:",
                error
            );

        }

        return res.sendStatus(200);
    }
);


/*
========================================
TELEGRAM LONG POLLING
========================================
*/

let telegramOffset = 0;

let telegramPolling = false;


function sleep(
    milliseconds
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );

}


async function startTelegramPolling() {

    if (telegramPolling) {
        return;
    }

    if (!telegramEnabled) {
        return;
    }

    if (!TELEGRAM_ADMIN_USER_ID) {

        console.warn(
            "Telegram polling not started because TELEGRAM_ADMIN_USER_ID is missing."
        );

        return;
    }

    telegramPolling = true;

    console.log(
        "Telegram updates: LONG POLLING"
    );


    while (telegramPolling) {

        try {

            const params =
                new URLSearchParams();

            params.set(
                "timeout",
                "50"
            );

            params.set(
                "allowed_updates",
                JSON.stringify([
                    "callback_query",
                    "message"
                ])
            );

            if (telegramOffset) {

                params.set(
                    "offset",
                    String(
                        telegramOffset
                    )
                );

            }

            const url =
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?${params.toString()}`;


            const controller =
                new AbortController();

            const timeout =
                setTimeout(
                    () => {
                        controller.abort();
                    },
                    60000
                );


            let response;

            try {

                response =
                    await fetch(
                        url,
                        {
                            method:
                                "GET",

                            signal:
                                controller.signal
                        }
                    );

            } finally {

                clearTimeout(
                    timeout
                );

            }


            const data =
                await response
                    .json()
                    .catch(
                        () => null
                    );


            if (
                !response.ok ||
                !data ||
                !data.ok
            ) {

                console.error(
                    "Telegram getUpdates error:",
                    data
                );

                await sleep(5000);

                continue;
            }


            const updates =
                data.result || [];


            for (
                const update
                of updates
            ) {

                telegramOffset =
                    update.update_id + 1;


                if (
                    update.callback_query
                ) {

                    await handleTelegramCallback(
                        update.callback_query
                    );

                }

                if (
                    update.message
                ) {

                    await handleTelegramAdminMessage(
                        update.message
                    );

                }

            }

        } catch (error) {

            if (
                error.name !==
                "AbortError"
            ) {

                console.error(
                    "Telegram polling error:",
                    error.message
                );

            }

            await sleep(2000);

        }

    }

}


/*
========================================
TELEGRAM UPDATE CONFIGURATION
========================================
*/

async function setupTelegramUpdates() {

    if (!telegramEnabled) {
        return;
    }

    if (!TELEGRAM_ADMIN_USER_ID) {

        console.warn(
            "Telegram buttons disabled because TELEGRAM_ADMIN_USER_ID is missing."
        );

        return;
    }


    /*
    WEBHOOK
    */

    if (
        TELEGRAM_WEBHOOK_URL
    ) {

        if (
            !TELEGRAM_WEBHOOK_SECRET
        ) {

            console.error(
                "TELEGRAM_WEBHOOK_URL is set but TELEGRAM_WEBHOOK_SECRET is missing."
            );

            return;
        }


        try {

            await telegramApi(
                "setWebhook",
                {
                    url:
                        TELEGRAM_WEBHOOK_URL,

                    secret_token:
                        TELEGRAM_WEBHOOK_SECRET,

                    allowed_updates: [
                        "callback_query",
                        "message"
                    ],

                    drop_pending_updates:
                        false
                }
            );


            console.log(
                "Telegram updates: WEBHOOK"
            );

            console.log(
                `Webhook URL: ${TELEGRAM_WEBHOOK_URL}`
            );

        } catch (error) {

            console.error(
                "Telegram webhook setup error:",
                error.message
            );

        }

        return;
    }


    /*
    TERMUX / LOCAL MODE
    */

    try {

        await telegramApi(
            "deleteWebhook",
            {
                drop_pending_updates:
                    false
            }
        );


        startTelegramPolling();

    } catch (error) {

        console.error(
            "Unable to start Telegram polling:",
            error.message
        );

    }

}


/*
========================================
TELEGRAM MINI APP AUTHENTICATION
========================================

Verifies the `initData` string that
Telegram signs and hands to the Mini App
on load (window.Telegram.WebApp.initData).

This is a separate HMAC check from the
webhook secret used for admin approvals.
Reference:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app

If it verifies, we know for certain the
request really came from that Telegram
user, with no password needed.
========================================
*/

function verifyTelegramInitData(
    initData,
    botToken
) {

    const params =
        new URLSearchParams(initData);

    const hash =
        params.get("hash");

    if (!hash) return null;

    params.delete("hash");

    /*
    Data-check-string: all remaining fields,
    sorted by key, joined with \n
    */

    const dataCheckArr = [];

    for (const [key, value] of [...params.entries()].sort(
        (a, b) => a[0].localeCompare(b[0])
    )) {
        dataCheckArr.push(`${key}=${value}`);
    }

    const dataCheckString =
        dataCheckArr.join("\n");

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey =
        crypto
            .createHmac("sha256", "WebAppData")
            .update(botToken)
            .digest();

    const computedHash =
        crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

    if (computedHash !== hash) {
        return null; // tampered or forged
    }

    /*
    Reject stale initData (Telegram
    recommends this — anything older than
    24h should not be trusted).
    */

    const authDate =
        Number(params.get("auth_date"));

    const MAX_AGE_SECONDS =
        24 * 60 * 60;

    if (
        !authDate ||
        (Date.now() / 1000 - authDate) > MAX_AGE_SECONDS
    ) {
        return null;
    }

    const userJson =
        params.get("user");

    if (!userJson) return null;

    return JSON.parse(userJson);
    // { id, first_name, last_name, username, ... }

}


/*
========================================
TELEGRAM AUTO SIGNUP / LOGIN
========================================

Single endpoint that either creates the
account (first time opening the Mini App)
or just logs the existing user in
(returning), then sets the same session
cookie used everywhere else in this file.

This is what auth.html calls automatically
on load — the user never sees or fills a
form.
========================================
*/

app.post(
    "/api/auth/telegram",
    async (req, res) => {

        try {

            const {
                initData,
                ref
            } = req.body;

            console.log(
                "POST /api/auth/telegram — request received. initData present:",
                Boolean(initData)
            );

            if (!initData) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Missing Telegram data."
                });

            }

            const tgUser =
                verifyTelegramInitData(
                    initData,
                    TELEGRAM_WEBAPP_BOT_TOKEN
                );

            if (!tgUser) {

                console.warn(
                    "Telegram auth: initData failed verification. " +
                    "Check TELEGRAM_WEBAPP_BOT_TOKEN matches the bot the Mini App was opened from."
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Could not verify Telegram identity."
                });

            }

            console.log(
                "Telegram auth: verified user",
                tgUser.id,
                tgUser.username || "(no username)"
            );

            const telegramId =
                String(tgUser.id);

            const {
                data: existingUser,
                error: lookupError
            } = await supabase
                .from("users")
                .select("id")
                .eq(
                    "telegram_id",
                    telegramId
                )
                .maybeSingle();

            if (lookupError) {

                console.error(
                    "Telegram user lookup error:",
                    lookupError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to check account."
                });

            }

            let userId;
            let isNewUser = false;

            if (existingUser) {

                userId =
                    existingUser.id;

            } else {

                /*
                Auto-generate a unique username
                from Telegram data. Falls back to
                "user" if Telegram gives us nothing
                usable, then appends a number until
                it's free.
                */

                const base =
                    (
                        tgUser.username ||
                        tgUser.first_name ||
                        "user"
                    )
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "")
                        .slice(0, 15) || "user";

                let candidateUsername =
                    base;

                let suffix = 0;

                while (true) {

                    const { data: taken } =
                        await supabase
                            .from("users")
                            .select("id")
                            .eq(
                                "username",
                                candidateUsername
                            )
                            .maybeSingle();

                    if (!taken) break;

                    suffix += 1;

                    candidateUsername =
                        `${base}${suffix}`;

                }

                let referrer = null;

                console.log(
                    "Telegram signup: ref param received =",
                    JSON.stringify(ref)
                );

                if (ref) {

                    const { data: referrerRow, error: referrerLookupError } =
                        await supabase
                            .from("users")
                            .select("id, username")
                            .eq(
                                "username",
                                String(ref).toLowerCase()
                            )
                            .maybeSingle();

                    if (referrerLookupError) {

                        console.error(
                            "Telegram signup: referrer lookup error:",
                            referrerLookupError
                        );

                    }

                    console.log(
                        "Telegram signup: referrer lookup result =",
                        referrerRow
                    );

                    referrer =
                        referrerRow;

                }

                const {
                    data: newUser,
                    error: insertError
                } = await supabase
                    .from("users")
                    .insert({
                        full_name:
                            [
                                tgUser.first_name,
                                tgUser.last_name
                            ]
                                .filter(Boolean)
                                .join(" ") ||
                            candidateUsername,

                        username:
                            candidateUsername,

                        email:
                            null,

                        password_hash:
                            null,

                        telegram_id:
                            telegramId,

                        telegram_username:
                            tgUser.username || null,

                        balance:
                            WELCOME_BONUS,

                        total_earned:
                            0,

                        welcome_bonus_shown:
                            false,

                        referred_by:
                            referrer
                                ? referrer.id
                                : null
                    })
                    .select("id, created_at")
                    .single();

                if (insertError) {

                    console.error(
                        "Telegram signup error:",
                        insertError
                    );

                    return res.status(500).json({
                        success: false,
                        message:
                            "Unable to create your account."
                    });

                }

                userId =
                    newUser.id;

                isNewUser = true;

                if (referrer) {

                    const {
                        data: referralResult,
                        error: referralError
                    } = await supabase
                        .rpc(
                            "credit_referral_bonus",
                            {
                                p_referrer_id:
                                    referrer.id,

                                p_referred_user_id:
                                    userId,

                                p_amount:
                                    REFERRAL_BONUS
                            }
                        );

                    if (referralError) {

                        console.error(
                            "Referral bonus RPC error:",
                            referralError
                        );

                    } else {

                        console.log(
                            "Referral bonus RPC result:",
                            referralResult
                        );

                    }

                }

                /*
                ========================================
                NOTIFY ADMIN (TELEGRAM) — BACKGROUND
                ========================================

                Same pattern as the legacy email/password
                signup endpoint: best-effort, does not
                block the response to the new user.
                ========================================
                */

                if (telegramEnabled) {

                    const signupTime =
                        new Date(
                            newUser.created_at || Date.now()
                        ).toLocaleString(
                            "en-NG",
                            {
                                timeZone:
                                    "Africa/Lagos"
                            }
                        );

                    telegramApi(
                        "sendMessage",
                        {
                            chat_id:
                                TELEGRAM_ADMIN_CHAT_ID,

                            text:
`🆕 NEW USER SIGNUP (Telegram)

━━━━━━━━━━━━━━━━━━

👤 Name:
${[tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || candidateUsername}

🔗 Username:
@${candidateUsername}

📱 Telegram:
${tgUser.username ? "@" + tgUser.username : "(no @username)"} (ID: ${telegramId})

🆔 User ID:
${userId}

👥 Referred by:
${referrer ? "@" + referrer.username : "None"}

🕐 Signed up:
${signupTime}`
                        }
                    ).catch(
                        (telegramError) => {

                            console.error(
                                "Telegram signup notify error:",
                                telegramError.message
                            );

                        }
                    );

                }

            }

            const token =
                jwt.sign(
                    {
                        userId:
                            userId
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "7d"
                    }
                );

            res.cookie(
                "netnaira_session",
                token,
                {
                    httpOnly:
                        true,

                    secure:
                        process.env.NODE_ENV ===
                        "production",

                    sameSite:
                        "lax",

                    maxAge:
                        7 *
                        24 *
                        60 *
                        60 *
                        1000
                }
            );

            return res.json({
                success:
                    true
            });

        } catch (error) {

            console.error(
                "Telegram auth error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Something went wrong."
            });

        }

    }
);


/*
========================================
SIGN UP (legacy email/password — kept as
a fallback; you can remove this block
entirely once Telegram auth is your only
entry point)
========================================
*/

app.post(
    "/api/auth/signup",
    async (req, res) => {

        try {

            const {
                fullName,
                username,
                email,
                password,
                ref
            } = req.body;


            if (
                !fullName ||
                !username ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please complete all fields."
                });

            }


            const cleanFullName =
                fullName.trim();

            const cleanUsername =
                username
                    .trim()
                    .toLowerCase();

            const cleanEmail =
                email
                    .trim()
                    .toLowerCase();

            /*
            Referral code is just the referrer's
            username, lowercased the same way
            usernames are stored. Empty/missing
            is fine — it just means no referrer.
            */

            const cleanRef =
                typeof ref === "string"
                    ? ref.trim().toLowerCase()
                    : "";


            if (
                !/^[a-z0-9_]{3,20}$/.test(
                    cleanUsername
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Username must be 3-20 characters and contain only letters, numbers and underscores."
                });

            }


            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    cleanEmail
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid email address."
                });

            }


            if (
                password.length < 8
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Password must contain at least 8 characters."
                });

            }


            /*
            Username
            */

            const {
                data: usernameUser,
                error: usernameError
            } = await supabase
                .from("users")
                .select("id")
                .eq(
                    "username",
                    cleanUsername
                )
                .maybeSingle();


            if (usernameError) {

                console.error(
                    "Username check error:",
                    usernameError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to check username."
                });

            }


            if (usernameUser) {

                return res.status(409).json({
                    success: false,
                    message:
                        "That username is already taken."
                });

            }


            /*
            Email
            */

            const {
                data: emailUser,
                error: emailError
            } = await supabase
                .from("users")
                .select("id")
                .eq(
                    "email",
                    cleanEmail
                )
                .maybeSingle();


            if (emailError) {

                console.error(
                    "Email check error:",
                    emailError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to check email."
                });

            }


            if (emailUser) {

                return res.status(409).json({
                    success: false,
                    message:
                        "An account with that email already exists."
                });

            }


            /*
            Password
            */

            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );


            /*
            ========================================
            REFERRER LOOKUP
            ========================================

            A missing or invalid ?ref= just means
            "no referrer" — it never blocks signup.
            You can't refer yourself since this
            account doesn't exist yet, and a
            username can't match its own future
            username anyway.
            */

            let referrer = null;

            if (cleanRef) {

                const {
                    data: referrerRow,
                    error: referrerError
                } = await supabase
                    .from("users")
                    .select("id, username")
                    .eq(
                        "username",
                        cleanRef
                    )
                    .maybeSingle();


                if (referrerError) {

                    console.error(
                        "Referrer lookup error:",
                        referrerError
                    );

                } else {

                    referrer =
                        referrerRow;

                }

            }


            /*
            Create account
            */

            const {
                data: user,
                error
            } = await supabase
                .from("users")
                .insert({
                    full_name:
                        cleanFullName,

                    username:
                        cleanUsername,

                    email:
                        cleanEmail,

                    password_hash:
                        passwordHash,

                    balance:
                        WELCOME_BONUS,

                    total_earned:
                        0,

                    welcome_bonus_shown:
                        false,

                    referred_by:
                        referrer
                            ? referrer.id
                            : null
                })
                .select(
                    "id, full_name, username, email, created_at"
                )
                .single();


            if (error) {

                console.error(
                    "Signup database error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to create your account."
                });

            }


            /*
            ========================================
            CREDIT REFERRAL BONUS
            ========================================

            Best-effort: if this fails, the new
            account is still created normally — we
            just log it. The unique index in
            credit_referral_bonus() means this can
            never double-pay a referrer even if
            retried.
            */

            if (referrer) {

                try {

                    const {
                        data: referralResult,
                        error: referralError
                    } = await supabase
                        .rpc(
                            "credit_referral_bonus",
                            {
                                p_referrer_id:
                                    referrer.id,

                                p_referred_user_id:
                                    user.id,

                                p_amount:
                                    REFERRAL_BONUS
                            }
                        );


                    if (referralError) {

                        console.error(
                            "Referral bonus RPC error:",
                            referralError
                        );

                    } else if (
                        !referralResult ||
                        referralResult.success !== true
                    ) {

                        console.warn(
                            "Referral bonus not credited:",
                            referralResult?.message
                        );

                    } else {

                        console.log(
                            `Referral bonus: ₦${REFERRAL_BONUS} credited to @${referrer.username} for referring @${cleanUsername}`
                        );

                    }

                } catch (referralCatchError) {

                    console.error(
                        "Referral bonus error:",
                        referralCatchError
                    );

                }

            }


            /*
            Session
            */

            const token =
                jwt.sign(
                    {
                        userId:
                            user.id
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "7d"
                    }
                );


            res.cookie(
                "netnaira_session",
                token,
                {
                    httpOnly:
                        true,

                    secure:
                        process.env.NODE_ENV ===
                        "production",

                    sameSite:
                        "lax",

                    maxAge:
                        7 *
                        24 *
                        60 *
                        60 *
                        1000
                }
            );


            /*
            ========================================
            RESPOND TO CLIENT IMMEDIATELY
            ========================================

            The account already exists at this
            point. Notifying Telegram below can
            take a moment (network round trip to
            the Bot API), and there's no reason to
            make the new user's browser wait on it
            — same pattern used for deposits and
            withdrawals elsewhere in this file.
            */

            res.status(201).json({
                success:
                    true,

                message:
                    "Account created successfully."
            });


            /*
            ========================================
            NOTIFY ADMIN (TELEGRAM) — BACKGROUND
            ========================================

            Best-effort. If this fails (Telegram
            down, bad token, etc.) the signup itself
            is unaffected — we've already responded
            to the user — so we only log the error.
            */

            if (telegramEnabled) {

                const signupTime =
                    new Date(
                        user.created_at || Date.now()
                    ).toLocaleString(
                        "en-NG",
                        {
                            timeZone:
                                "Africa/Lagos"
                        }
                    );

                telegramApi(
                    "sendMessage",
                    {
                        chat_id:
                            TELEGRAM_ADMIN_CHAT_ID,

                        text:
`🆕 NEW USER SIGNUP

━━━━━━━━━━━━━━━━━━

👤 Name:
${cleanFullName}

🔗 Username:
@${cleanUsername}

📧 Email:
${cleanEmail}

🆔 User ID:
${user.id}

👥 Referred by:
${referrer ? "@" + referrer.username : "None"}

🕐 Signed up:
${signupTime}`
                    }
                ).catch(
                    (telegramError) => {

                        console.error(
                            "Signup Telegram notify error:",
                            telegramError.message
                        );

                    }
                );

            }


            return;


        } catch (error) {

            console.error(
                "Signup error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Something went wrong."
            });

        }

    }
);


/*
========================================
LOGIN
========================================
*/

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const {
                identifier,
                password
            } = req.body;


            if (
                !identifier ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Enter your username/email and password."
                });

            }


            const cleanIdentifier =
                identifier
                    .trim()
                    .toLowerCase();


            let query =
                supabase
                    .from("users")
                    .select("*");


            if (
                cleanIdentifier.includes("@")
            ) {

                query =
                    query.eq(
                        "email",
                        cleanIdentifier
                    );

            } else {

                query =
                    query.eq(
                        "username",
                        cleanIdentifier
                    );

            }


            const {
                data: user,
                error
            } =
                await query.maybeSingle();


            if (error) {

                console.error(
                    "Login database error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to process login."
                });

            }


            if (!user) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid login details."
                });

            }


            const passwordCorrect =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );


            if (!passwordCorrect) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid login details."
                });

            }


            const token =
                jwt.sign(
                    {
                        userId:
                            user.id
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "7d"
                    }
                );


            res.cookie(
                "netnaira_session",
                token,
                {
                    httpOnly:
                        true,

                    secure:
                        process.env.NODE_ENV ===
                        "production",

                    sameSite:
                        "lax",

                    maxAge:
                        7 *
                        24 *
                        60 *
                        60 *
                        1000
                }
            );


            return res.json({
                success:
                    true,

                message:
                    "Login successful."
            });


        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Something went wrong."
            });

        }

    }
);


/*
========================================
CURRENT USER
========================================
*/

app.get(
    "/api/auth/me",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: user,
                error
            } = await supabase
                .from("users")
                .select(
                    "id, full_name, username, email, balance, total_earned, created_at"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (
                error ||
                !user
            ) {

                console.error(
                    "Auth/me error:",
                    error
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            return res.json({
                success:
                    true,

                user
            });


        } catch (error) {

            console.error(
                "Auth/me error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load account."
            });

        }

    }
);


/*
========================================
CHANGE PASSWORD
========================================
*/

app.post(
    "/api/auth/change-password",
    authenticate,
    async (req, res) => {

        try {

            const {
                currentPassword,
                newPassword
            } = req.body;


            if (
                !currentPassword ||
                !newPassword
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please fill in both password fields."
                });

            }


            if (
                newPassword.length < 8
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "New password must contain at least 8 characters."
                });

            }


            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "id, password_hash"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (
                userError ||
                !user
            ) {

                console.error(
                    "Change password user lookup error:",
                    userError
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            const currentPasswordCorrect =
                await bcrypt.compare(
                    currentPassword,
                    user.password_hash
                );


            if (!currentPasswordCorrect) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Your current password is incorrect."
                });

            }


            const newPasswordHash =
                await bcrypt.hash(
                    newPassword,
                    12
                );


            const {
                error: updateError
            } = await supabase
                .from("users")
                .update({
                    password_hash:
                        newPasswordHash
                })
                .eq(
                    "id",
                    req.userId
                );


            if (updateError) {

                console.error(
                    "Change password update error:",
                    updateError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to update your password."
                });

            }


            return res.json({
                success:
                    true,

                message:
                    "Password updated successfully."
            });


        } catch (error) {

            console.error(
                "Change password error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Something went wrong."
            });

        }

    }
);


/*
========================================
GET DEPOSIT HISTORY
========================================

This endpoint is specifically for
deposit.html.

Returns the user's latest 2 deposits.
========================================
*/

app.get(
    "/api/deposits",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: deposits,
                error
            } = await supabase
                .from("deposit_requests")
                .select(
                    "id, amount, status, created_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(2);


            if (error) {

                console.error(
                    "Deposit history error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load deposit history."
                });

            }


            return res.json({

                success:
                    true,

                deposits:
                    deposits || []

            });


        } catch (error) {

            console.error(
                "Deposit history error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load deposit history."
            });

        }

    }
);


/*
========================================
DEPOSIT STATUS
========================================

Allows the frontend to check one
specific deposit.
========================================
*/

app.get(
    "/api/deposits/status/:id",
    authenticate,
    async (req, res) => {

        try {

            const depositId =
                req.params.id;


            const {
                data: deposit,
                error
            } = await supabase
                .from("deposit_requests")
                .select(
                    "id, amount, status, created_at"
                )
                .eq(
                    "id",
                    depositId
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .maybeSingle();


            if (error) {

                console.error(
                    "Deposit status error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to check deposit status."
                });

            }


            if (!deposit) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Deposit not found."
                });

            }


            return res.json({
                success:
                    true,

                deposit
            });


        } catch (error) {

            console.error(
                "Deposit status error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to check deposit status."
            });

        }

    }
);


/*
========================================
DASHBOARD DATA
========================================
*/

app.get(
    "/api/dashboard",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: user,
                error
            } = await supabase
                .from("users")
                .select(
                    "id, full_name, username, balance, total_earned, created_at, welcome_bonus_shown"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (error) {

                console.error(
                    "Dashboard database error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load dashboard."
                });

            }


            if (!user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            const {
                data: recentDeposits,
                error: depositsError
            } = await supabase
                .from("deposit_requests")
                .select(
                    "id, amount, status, created_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(2);


            if (depositsError) {

                console.error(
                    "Recent deposits error:",
                    depositsError
                );

            }


            /*
            ========================================
            ACTIVE PLAN
            ========================================

            A user can only have one plan running
            at a time (see activate_plan RPC), so
            the most recent "active" row is it.
            ========================================
            */

            const {
                data: activePlanRow,
                error: activePlanError
            } = await supabase
                .from("user_plans")
                .select(
                    "id, plan_name, daily_income, duration_days, days_paid, last_credited_at, started_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .eq(
                    "status",
                    "active"
                )
                .order(
                    "started_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(1)
                .maybeSingle();


            if (activePlanError) {

                console.error(
                    "Active plan error:",
                    activePlanError
                );

            }


            let activePlan = null;
            let dailyEarning = 0;
            let daysCompleted = 0;
            let daysRemaining = 0;
            let progress = 0;
            let todayEarned = 0;
            let durationDays = 0;
            let startedAt = null;
            let planAmount = 0;
            let planTotalReturn = 0;

            if (activePlanRow) {

                activePlan =
                    activePlanRow.plan_name;

                dailyEarning =
                    Number(
                        activePlanRow.daily_income || 0
                    );

                daysCompleted =
                    activePlanRow.days_paid || 0;

                durationDays =
                    activePlanRow.duration_days || 0;

                startedAt =
                    activePlanRow.started_at || null;

                /*
                Look up the invested amount and
                total expected return from the
                server-side plan catalog (source
                of truth), matched by plan name.
                This is display-only — never used
                for crediting logic.
                */

                const catalogPlan =
                    EARNING_PLANS[activePlan];

                if (catalogPlan) {

                    planAmount =
                        catalogPlan.amount;

                    planTotalReturn =
                        catalogPlan.total;

                }

                daysRemaining =
                    Math.max(
                        0,
                        activePlanRow.duration_days -
                            daysCompleted
                    );

                progress =
                    Math.round(
                        (daysCompleted /
                            activePlanRow.duration_days) *
                            100
                    );

                /*
                todayEarned only shows the daily
                amount once TODAY's credit has
                actually landed (the sweep runs on
                an interval, not exactly at midnight).
                */

                const todayDateString =
                    new Date()
                        .toISOString()
                        .slice(0, 10);

                if (
                    activePlanRow.last_credited_at ===
                    todayDateString
                ) {

                    todayEarned =
                        dailyEarning;

                }

            }


            return res.json({

                success:
                    true,

                user: {

                    id:
                        user.id,

                    fullName:
                        user.full_name,

                    username:
                        user.username,

                    balance:
                        Number(
                            user.balance || 0
                        ),

                    totalEarned:
                        Number(
                            user.total_earned || 0
                        ),

                    todayEarned:
                        todayEarned,

                    activePlan:
                        activePlan,

                    dailyEarning:
                        dailyEarning,

                    daysCompleted:
                        daysCompleted,

                    daysRemaining:
                        daysRemaining,

                    progress:
                        progress,

                    durationDays:
                        durationDays,

                    startedAt:
                        startedAt,

                    planAmount:
                        planAmount,

                    planTotalReturn:
                        planTotalReturn,

                    recentDeposits:
                        recentDeposits ||
                        [],

                    /*
                    True only until the dashboard
                    acknowledges it via
                    POST /api/user/ack-welcome-bonus.
                    Existing accounts (created before
                    this column existed) default to
                    true in the DB, so they never see
                    this popup retroactively.
                    */

                    showWelcomeBonus:
                        user.welcome_bonus_shown ===
                        false,

                    welcomeBonusAmount:
                        WELCOME_BONUS

                }

            });


        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load dashboard."
            });

        }

    }
);


/*
========================================
ACKNOWLEDGE WELCOME BONUS POPUP
========================================

Called once by dashboard.html right as it
shows the "you've been credited" / "join
Telegram" popup sequence to a brand-new
user. Flips welcome_bonus_shown to true
so the sequence never appears again for
this account, even across devices.
========================================
*/

app.post(
    "/api/user/ack-welcome-bonus",
    authenticate,
    async (req, res) => {

        try {

            const { error } =
                await supabase
                    .from("users")
                    .update({
                        welcome_bonus_shown:
                            true
                    })
                    .eq(
                        "id",
                        req.userId
                    );

            if (error) {

                console.error(
                    "Ack welcome bonus error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to update account."
                });

            }

            return res.json({
                success:
                    true
            });

        } catch (error) {

            console.error(
                "Ack welcome bonus error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Something went wrong."
            });

        }

    }
);


/*
========================================
REFERRALS DATA
========================================

Used by refer.html to show the user's
referral link, how much they've earned
from referrals, and recent referral
activity.
========================================
*/

app.get(
    "/api/referrals",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "username, balance, referral_balance"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (
                userError ||
                !user
            ) {

                console.error(
                    "Referrals user error:",
                    userError
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            const {
                data: earnings,
                error: earningsError
            } = await supabase
                .from("referral_earnings")
                .select(
                    "referred_user_id, amount, created_at"
                )
                .eq(
                    "referrer_id",
                    req.userId
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


            if (earningsError) {

                console.error(
                    "Referral earnings error:",
                    earningsError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load referral data."
                });

            }


            const referralRows =
                earnings || [];


            const totalReferrals =
                referralRows.length;


            const totalEarned =
                referralRows.reduce(
                    (sum, row) =>
                        sum + Number(row.amount || 0),
                    0
                );


            /*
            Look up usernames for the most recent
            referrals so the history list can show
            "@username joined" instead of just an
            amount and a date.
            */

            const recentRows =
                referralRows.slice(0, 10);

            const referredIds =
                recentRows.map(
                    row => row.referred_user_id
                );

            let referredUsersById = {};

            if (referredIds.length > 0) {

                const {
                    data: referredUsers,
                    error: referredUsersError
                } = await supabase
                    .from("users")
                    .select(
                        "id, username"
                    )
                    .in(
                        "id",
                        referredIds
                    );


                if (referredUsersError) {

                    console.error(
                        "Referred users lookup error:",
                        referredUsersError
                    );

                } else {

                    referredUsersById =
                        Object.fromEntries(
                            (referredUsers || []).map(
                                row => [row.id, row.username]
                            )
                        );

                }

            }


            const history =
                recentRows.map(
                    row => ({

                        username:
                            referredUsersById[
                                row.referred_user_id
                            ] || "a new member",

                        amount:
                            Number(row.amount || 0),

                        createdAt:
                            row.created_at

                    })
                );


            /*
            Whether the user currently has an active
            plan — the referral balance can only be
            withdrawn to the main balance while a plan
            is running. Mirrors the check enforced
            server-side in withdraw_referral_balance().
            */

            const {
                data: activePlanRow,
                error: activePlanError
            } = await supabase
                .from("user_plans")
                .select("id")
                .eq("user_id", req.userId)
                .eq("status", "active")
                .limit(1)
                .maybeSingle();


            if (activePlanError) {

                console.error(
                    "Referral active-plan check error:",
                    activePlanError
                );

            }


            const hasActivePlan =
                Boolean(activePlanRow);


            return res.json({

                success:
                    true,

                referralCode:
                    user.username,

                referralLink:
                    `https://t.me/${TELEGRAM_WEBAPP_BOT_USERNAME}/${TELEGRAM_WEBAPP_SHORT_NAME}?startapp=${user.username}`,

                bonusPerReferral:
                    REFERRAL_BONUS,

                totalReferrals:
                    totalReferrals,

                totalEarned:
                    totalEarned,

                referralBalance:
                    Number(user.referral_balance || 0),

                mainBalance:
                    Number(user.balance || 0),

                minWithdrawal:
                    MIN_REFERRAL_WITHDRAWAL,

                hasActivePlan:
                    hasActivePlan,

                history:
                    history

            });


        } catch (error) {

            console.error(
                "Referrals error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load referral data."
            });

        }

    }
);


/*
========================================
WITHDRAW REFERRAL BALANCE TO MAIN BALANCE
========================================

Moves money from referral_balance into the
user's main, spendable balance.

Both rules are enforced again inside the
withdraw_referral_balance() Postgres function
(the real source of truth, run under a row
lock) — the checks here are just so the user
gets an immediate, friendly error without a
round trip to a function that will reject
them anyway:

  - minimum ₦2,000 per withdrawal
  - an active earning plan is required
========================================
*/

app.post(
    "/api/referrals/withdraw",
    authenticate,
    async (req, res) => {

        try {

            const amount =
                Number(req.body?.amount);


            if (
                !Number.isFinite(amount) ||
                amount < MIN_REFERRAL_WITHDRAWAL
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        `Minimum withdrawal is ₦${MIN_REFERRAL_WITHDRAWAL.toLocaleString("en-NG")}.`
                });

            }


            const {
                data: result,
                error
            } = await supabase
                .rpc(
                    "withdraw_referral_balance",
                    {
                        p_user_id:
                            req.userId,

                        p_amount:
                            amount
                    }
                );


            if (error) {

                console.error(
                    "Referral withdrawal RPC error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to process withdrawal."
                });

            }


            if (
                !result ||
                result.success !== true
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        result?.message ||
                        "Unable to process withdrawal."
                });

            }


            return res.json({

                success:
                    true,

                message:
                    `₦${amount.toLocaleString("en-NG")} moved to your main balance.`,

                amount:
                    amount

            });


        } catch (error) {

            console.error(
                "Referral withdrawal error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to process withdrawal."
            });

        }

    }
);


/*
========================================
PLAN ACTIVATION
========================================

Activates an earning plan using the
user's balance.

Everything that matters (price, daily
income, duration) is looked up from
EARNING_PLANS on the server — the
client only tells us the plan NAME.

The actual balance check + deduction +
first day's payout happen atomically
inside the activate_plan() Postgres
function, so two rapid clicks (or two
tabs) can't double-activate or overdraw
the balance.
========================================
*/

app.post(
    "/api/plans/activate",
    authenticate,
    async (req, res) => {

        try {

            const planName =
                typeof req.body?.plan === "string"
                    ? req.body.plan.trim()
                    : "";


            const plan =
                EARNING_PLANS[planName];


            if (!plan) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Unknown plan selected."
                });

            }


            const {
                data,
                error
            } = await supabase
                .rpc(
                    "activate_plan",
                    {
                        p_user_id:
                            req.userId,

                        p_plan_name:
                            planName,

                        p_amount:
                            plan.amount,

                        p_daily_income:
                            plan.daily,

                        p_total_return:
                            plan.total,

                        p_duration_days:
                            plan.durationDays
                    }
                );


            if (error) {

                console.error(
                    "Plan activation RPC error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to activate plan."
                });

            }


            if (
                !data ||
                data.success !== true
            ) {

                const failureMessage =
                    (data && data.message) ||
                    "Plan activation failed.";

                /*
                Insufficient balance is a normal,
                expected case (not a server error) —
                the plans.html page already checks
                the balance client-side, but the
                database check here is the real one.
                */

                return res.status(400).json({
                    success: false,
                    message:
                        failureMessage
                });

            }


            console.log(
                `Plan activated: user ${req.userId} | ${planName} | ₦${plan.amount}`
            );


            return res.json({

                success:
                    true,

                message:
                    `${planName} plan activated successfully.`,

                planId:
                    data.plan_id,

                newBalance:
                    Number(
                        data.new_balance || 0
                    ),

                dailyIncome:
                    Number(
                        data.daily_income ||
                        plan.daily
                    )

            });


        } catch (error) {

            console.error(
                "Plan activation error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to activate plan."
            });

        }

    }
);


/*
========================================
DEPOSIT PAGE DATA
========================================

Used by deposit.html on load to show
the current balance and the user's
last 2 deposit requests.

This endpoint did not exist before,
which is why the deposit history and
header balance on that page never
loaded (the fetch to it was a 404).
========================================
*/

app.get(
    "/api/deposit-page",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "balance"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (
                userError ||
                !user
            ) {

                console.error(
                    "Deposit page user error:",
                    userError
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            const {
                data: history,
                error: historyError
            } = await supabase
                .from("deposit_requests")
                .select(
                    "id, amount, status, created_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(2);


            if (historyError) {

                console.error(
                    "Deposit page history error:",
                    historyError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load deposit history."
                });

            }


            return res.json({

                success:
                    true,

                balance:
                    Number(
                        user.balance || 0
                    ),

                history:
                    history || []

            });


        } catch (error) {

            console.error(
                "Deposit page error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load deposit page data."
            });

        }

    }
);


/*
========================================
DEPOSIT VERIFICATION
========================================
*/

app.post(
    "/api/deposits/verify",
    authenticate,
    upload.single("screenshot"),

    async (req, res) => {

        let depositId = null;


        try {

            /*
            Telegram configuration
            */

            if (
                !TELEGRAM_BOT_TOKEN ||
                !TELEGRAM_ADMIN_CHAT_ID
            ) {

                return res.status(500).json({
                    success: false,
                    message:
                        "Deposit verification is temporarily unavailable."
                });

            }


            /*
            Amount
            */

            const amount =
                Number(
                    req.body.amount
                );


            if (
                !Number.isFinite(amount) ||
                amount < 3000 ||
                amount > 10000000
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid deposit amount (minimum ₦3,000)."
                });

            }


            /*
            Screenshot
            */

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please upload your payment screenshot."
                });

            }


            /*
            User
            */

            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "id, full_name, username"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();


            if (
                userError ||
                !user
            ) {

                console.error(
                    "Deposit user lookup error:",
                    userError
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }


            /*
            ========================================
            CHECK PENDING DEPOSIT
            ========================================
            */

            const {
                data: pendingDeposits,
                error: pendingError
            } = await supabase
                .from("deposit_requests")
                .select(
                    "id, amount, created_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .eq(
                    "status",
                    "pending"
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(1);


            if (pendingError) {

                console.error(
                    "Pending deposit check error:",
                    pendingError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to check your deposit status."
                });

            }


            if (
                pendingDeposits &&
                pendingDeposits.length > 0
            ) {

                const pending =
                    pendingDeposits[0];


                return res.status(429).json({

                    success:
                        false,

                    code:
                        "DEPOSIT_PENDING",

                    message:
                        "You already have a deposit verification pending. Please wait for it to be reviewed.",

                    deposit: {

                        id:
                            pending.id,

                        amount:
                            Number(
                                pending.amount
                            ),

                        createdAt:
                            pending.created_at,

                        status:
                            pending.status

                    }

                });

            }


            /*
            ========================================
            CREATE DEPOSIT
            ========================================
            */

            const {
                data: deposit,
                error: depositError
            } = await supabase
                .from("deposit_requests")
                .insert({

                    user_id:
                        req.userId,

                    amount:
                        amount,

                    status:
                        "pending"

                })
                .select(
                    "id, amount, created_at"
                )
                .single();


            if (depositError) {

                console.error(
                    "Deposit insert error:",
                    depositError
                );


                /*
                If a unique pending-deposit
                index exists, this catches
                simultaneous submissions.
                */

                if (
                    depositError.code ===
                    "23505"
                ) {

                    return res.status(429).json({

                        success:
                            false,

                        code:
                            "DEPOSIT_PENDING",

                        message:
                            "You already have a deposit verification pending. Please wait for it to be reviewed."

                    });

                }


                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to create deposit request."
                });

            }


            depositId =
                deposit.id;


            const submittedAt =
                new Date(
                    deposit.created_at
                ).toLocaleString(
                    "en-NG",
                    {
                        timeZone:
                            "Africa/Lagos"
                    }
                );


            /*
            ========================================
            RESPOND TO CLIENT IMMEDIATELY
            ========================================

            The deposit request already exists in
            the database as "pending" at this point.

            Everything from here on (building the
            Telegram caption, uploading the photo to
            Telegram, handling Telegram failures) can
            take several seconds if the connection is
            slow, and that used to leave the client's
            fetch() call open the whole time. On a
            flaky mobile connection that easily times
            out with "Failed to fetch" even though the
            deposit was recorded successfully.

            So we respond to the browser right away,
            and do the Telegram notification in the
            background. If it fails, the deposit is
            marked "telegram_failed" (as before) so
            the admin can be told to check manually
            and the user is allowed to resubmit.
            */

            res.json({

                success:
                    true,

                message:
                    "Deposit verification submitted successfully.",

                requestId:
                    depositId,

                amount:
                    Number(
                        deposit.amount
                    ),

                createdAt:
                    deposit.created_at

            });


            /*
            ========================================
            TELEGRAM CAPTION
            ========================================
            */

            const telegramCaption =

`💰 NEW DEPOSIT VERIFICATION

━━━━━━━━━━━━━━━━━━

👤 Name:
${user.full_name}

🔗 Username:
@${user.username}

🆔 User ID:
${user.id}

💵 Amount:
₦${amount.toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

🏦 Deposit Account:
6682064981

👤 Account Name:
Vtuexpress Jes (paymentpoint)

🏦 Bank:
PalmPay

📋 Request ID:
${depositId}

🕐 Submitted:
${submittedAt}

━━━━━━━━━━━━━━━━━━

⚠️ STATUS: PENDING REVIEW

Verify the actual payment before
approving this deposit.

The screenshot alone should not be
treated as proof of payment.`;


            /*
            ========================================
            SEND TO TELEGRAM (BACKGROUND)
            ========================================
            */

            try {

                const telegramUrl =
                    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;


                const telegramForm =
                    new FormData();


                telegramForm.append(
                    "chat_id",
                    TELEGRAM_ADMIN_CHAT_ID
                );


                telegramForm.append(
                    "caption",
                    telegramCaption
                );


                telegramForm.append(
                    "reply_markup",
                    JSON.stringify({

                        inline_keyboard: [

                            [

                                {
                                    text:
                                        "✅ Accept",

                                    callback_data:
                                        `deposit:approve:${depositId}`
                                },

                                {
                                    text:
                                        "❌ Reject",

                                    callback_data:
                                        `deposit:reject:${depositId}`
                                }

                            ]

                        ]

                    })
                );


                telegramForm.append(
                    "photo",
                    new Blob(
                        [
                            req.file.buffer
                        ],
                        {
                            type:
                                req.file.mimetype
                        }
                    ),
                    req.file.originalname
                );


                const telegramResponse =
                    await fetch(
                        telegramUrl,
                        {
                            method:
                                "POST",

                            body:
                                telegramForm
                        }
                    );


                const telegramData =
                    await telegramResponse
                        .json()
                        .catch(
                            () => null
                        );


                /*
                ========================================
                TELEGRAM FAILED
                ========================================
                */

                if (
                    !telegramResponse.ok ||
                    !telegramData ||
                    !telegramData.ok
                ) {

                    console.error(
                        "Telegram API error:",
                        telegramData
                    );


                    /*
                    VERY IMPORTANT:

                    Do not leave the deposit
                    stuck as pending.

                    It becomes telegram_failed,
                    which allows the user to
                    submit again.
                    */

                    await supabase
                        .from("deposit_requests")
                        .update({
                            status:
                                "telegram_failed"
                        })
                        .eq(
                            "id",
                            depositId
                        );

                }

            } catch (telegramSendError) {

                console.error(
                    "Telegram send error:",
                    telegramSendError
                );

                try {

                    await supabase
                        .from("deposit_requests")
                        .update({
                            status:
                                "telegram_failed"
                        })
                        .eq(
                            "id",
                            depositId
                        )
                        .eq(
                            "status",
                            "pending"
                        );

                } catch (cleanupError) {

                    console.error(
                        "Deposit cleanup error:",
                        cleanupError
                    );

                }

            }

            return;


        } catch (error) {

            console.error(
                "Deposit verification error:",
                error
            );


            /*
            If something fails AFTER
            creating the database record,
            don't leave it permanently
            stuck as pending.
            */

            if (depositId) {

                try {

                    await supabase
                        .from("deposit_requests")
                        .update({
                            status:
                                "telegram_failed"
                        })
                        .eq(
                            "id",
                            depositId
                        )
                        .eq(
                            "status",
                            "pending"
                        );

                } catch (cleanupError) {

                    console.error(
                        "Deposit cleanup error:",
                        cleanupError
                    );

                }

            }


            /*
            The response may have already been
            sent to the client (we now respond
            as soon as the deposit row exists,
            before the Telegram step). Sending
            a second response would crash the
            process, so only respond here if
            nothing has gone out yet.
            */

            if (res.headersSent) {
                return;
            }


            return res.status(500).json({

                success:
                    false,

                message:
                    "Unable to submit deposit verification."

            });

        }

    }
);


/*
========================================
MULTER ERROR HANDLER
========================================
*/

app.use(
    (error, req, res, next) => {

        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Screenshot is too large. Maximum size is 5MB."
                });

            }


            return res.status(400).json({
                success: false,
                message:
                    "Unable to upload screenshot."
            });

        }


        if (
            error &&
            error.message ===
                "Only JPG, PNG and WEBP images are allowed."
        ) {

            return res.status(400).json({
                success: false,
                message:
                    error.message
            });

        }


        console.error(
            "Unhandled server error:",
            error
        );


        return res.status(500).json({
            success: false,
            message:
                "Something went wrong."
        });

    }
);



/*
========================================
WITHDRAWAL ACCOUNT + WITHDRAWAL API
========================================
*/

app.get(
    "/api/withdrawal",
    authenticate,
    async (req, res) => {

        try {

            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "id, full_name, username, balance"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();

            if (userError || !user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }

            const {
                data: bankAccount,
                error: bankError
            } = await supabase
                .from("user_bank_accounts")
                .select(
                    "bank_name, account_number, account_name"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .maybeSingle();

            if (
                bankError &&
                bankError.code !== "PGRST116"
            ) {

                console.error(
                    "Withdrawal bank lookup error:",
                    bankError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load withdrawal account."
                });

            }

            /*
            ========================================
            RECENT WITHDRAWAL HISTORY
            ========================================

            Last 2 requests only, newest first, so
            the withdraw page can show the user
            what happened to their recent payouts.
            ========================================
            */

            const {
                data: recentWithdrawals,
                error: historyError
            } = await supabase
                .from("withdrawal_requests")
                .select(
                    "amount, status, created_at"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(2);

            if (historyError) {

                console.error(
                    "Withdrawal history error:",
                    historyError
                );

            }

            const history =
                (recentWithdrawals || []).map(
                    row => ({

                        amount:
                            Number(row.amount || 0),

                        status:
                            row.status,

                        createdAt:
                            row.created_at

                    })
                );

            return res.json({
                success: true,

                user: {
                    fullName:
                        user.full_name,

                    username:
                        user.username,

                    balance:
                        Number(user.balance || 0)
                },

                bankAccount:
                    bankAccount || null,

                minWithdrawal:
                    MIN_WITHDRAWAL,

                banks:
                    NIGERIAN_BANKS,

                history:
                    history
            });

        } catch (error) {

            console.error(
                "Withdrawal data error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load withdrawal data."
            });

        }

    }
);


app.post(
    "/api/withdrawal/bank-account",
    authenticate,
    async (req, res) => {

        try {

            const bankName =
                typeof req.body?.bankName === "string"
                    ? req.body.bankName.trim()
                    : "";

            const accountNumber =
                typeof req.body?.accountNumber === "string"
                    ? req.body.accountNumber.replace(/\D/g, "")
                    : "";

            const accountName =
                typeof req.body?.accountName === "string"
                    ? req.body.accountName.trim()
                    : "";

            if (
                !NIGERIAN_BANKS.includes(
                    bankName
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please select a valid bank."
                });

            }

            if (
                !/^\d{10}$/.test(
                    accountNumber
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Account number must contain 10 digits."
                });

            }

            if (
                accountName.length < 3 ||
                accountName.length > 120
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Enter the full account name."
                });

            }

            const {
                error
            } = await supabase
                .from("user_bank_accounts")
                .upsert(
                    {
                        user_id:
                            req.userId,

                        bank_name:
                            bankName,

                        account_number:
                            accountNumber,

                        account_name:
                            accountName,

                        updated_at:
                            new Date().toISOString()
                    },
                    {
                        onConflict:
                            "user_id"
                    }
                );

            if (error) {

                console.error(
                    "Save bank account error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to save your bank account."
                });

            }

            return res.json({
                success: true,
                message:
                    "Bank account saved successfully."
            });

        } catch (error) {

            console.error(
                "Bank account error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to save bank account."
            });

        }

    }
);


app.post(
    "/api/withdrawal/request",
    authenticate,
    async (req, res) => {

        try {

            const amount =
                Number(req.body?.amount);

            if (
                !Number.isFinite(amount) ||
                amount < MIN_WITHDRAWAL
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        `Minimum withdrawal is ₦${MIN_WITHDRAWAL.toLocaleString("en-NG")}.`
                });

            }

            if (
                !Number.isInteger(amount)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Withdrawal amount must be a whole naira amount."
                });

            }

            /*
            Count referrals from the existing
            referral_earnings table. No client
            value is trusted for this rule.
            */

            const {
                count: referralCount,
                error: referralError
            } = await supabase
                .from("referral_earnings")
                .select(
                    "referred_user_id",
                    {
                        count: "exact",
                        head: true
                    }
                )
                .eq(
                    "referrer_id",
                    req.userId
                );

            if (referralError) {

                console.error(
                    "Withdrawal referral count error:",
                    referralError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to verify your account."
                });

            }

            if (
                Number(referralCount || 0) <
                    MIN_WITHDRAWAL_REFERRALS
            ) {

                return res.status(403).json({
                    success: false,
                    code:
                        "REFERRAL_REQUIREMENT",

                    message:
                        "You need 5 referrals in order to withdraw."
                });

            }

            const {
                data: user,
                error: userError
            } = await supabase
                .from("users")
                .select(
                    "full_name, username, balance"
                )
                .eq(
                    "id",
                    req.userId
                )
                .single();

            if (userError || !user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });

            }

            const balance =
                Number(user.balance || 0);

            if (
                amount > balance
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient balance."
                });

            }

            const {
                data: bankAccount,
                error: bankError
            } = await supabase
                .from("user_bank_accounts")
                .select(
                    "bank_name, account_number, account_name"
                )
                .eq(
                    "user_id",
                    req.userId
                )
                .maybeSingle();

            if (bankError) {

                console.error(
                    "Withdrawal bank account error:",
                    bankError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to verify your bank account."
                });

            }

            if (!bankAccount) {

                return res.status(400).json({
                    success: false,
                    code:
                        "BANK_ACCOUNT_REQUIRED",

                    message:
                        "Please add your bank account first."
                });

            }

            /*
            Keep only one unresolved withdrawal
            per user. This also prevents repeated
            Telegram requests.
            */

            const {
                data: pendingWithdrawal,
                error: pendingError
            } = await supabase
                .from("withdrawal_requests")
                .select("id")
                .eq(
                    "user_id",
                    req.userId
                )
                .eq(
                    "status",
                    "pending"
                )
                .limit(1)
                .maybeSingle();

            if (pendingError) {

                console.error(
                    "Pending withdrawal lookup error:",
                    pendingError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to submit withdrawal."
                });

            }

            if (pendingWithdrawal) {

                return res.status(409).json({
                    success: false,
                    message:
                        "You already have a withdrawal request awaiting review."
                });

            }

            const {
                data: withdrawal,
                error: insertError
            } = await supabase
                .from("withdrawal_requests")
                .insert({
                    user_id:
                        req.userId,

                    amount:
                        amount,

                    bank_name:
                        bankAccount.bank_name,

                    account_number:
                        bankAccount.account_number,

                    account_name:
                        bankAccount.account_name,

                    status:
                        "pending"
                })
                .select(
                    "id, amount, bank_name, account_number, account_name, created_at"
                )
                .single();

            if (insertError || !withdrawal) {

                console.error(
                    "Withdrawal insert error:",
                    insertError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to submit withdrawal."
                });

            }

            /*
            Respond to the user only after the
            request is safely stored. Telegram is
            best-effort and does not make the
            browser wait for admin delivery.
            */

            res.json({
                success: true,
                message:
                    "Withdrawal request submitted successfully."
            });

            if (!telegramEnabled) {

                console.warn(
                    "Withdrawal created but Telegram is not configured:",
                    withdrawal.id
                );

                return;

            }

            try {

                await telegramApi(
                    "sendMessage",
                    {
                        chat_id:
                            TELEGRAM_ADMIN_CHAT_ID,

                        text:
`💸 NEW WITHDRAWAL REQUEST

💰 Amount:
₦${Number(withdrawal.amount).toLocaleString(
    "en-NG",
    {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
)}

👤 User:
${user.full_name || "Unknown"}

🔹 Username:
@${user.username || "unknown"}

🏦 Bank:
${withdrawal.bank_name}

🔢 Account Number:
${withdrawal.account_number}

👤 Account Name:
${withdrawal.account_name}

🆔 User ID:
${req.userId}

🕐 Requested:
${new Date(withdrawal.created_at).toLocaleString("en-NG")}

━━━━━━━━━━━━━━━━━━

Review this request carefully before approving.`,

                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text:
                                            "✅ ACCEPT",

                                        callback_data:
                                            `withdrawal:approve:${withdrawal.id}`
                                    },
                                    {
                                        text:
                                            "❌ REJECT",

                                        callback_data:
                                            `withdrawal:reject:${withdrawal.id}`
                                    }
                                ]
                            ]
                        }
                    }
                );

            } catch (telegramError) {

                /*
                The withdrawal row is already stored.
                Do not tell the user the request failed
                just because Telegram had a temporary
                problem. Log it for recovery.
                */

                console.error(
                    "Withdrawal Telegram send error:",
                    telegramError
                );

            }

        } catch (error) {

            console.error(
                "Withdrawal request error:",
                error
            );

            if (!res.headersSent) {

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to submit withdrawal."
                });

            }

        }

    }
);


/*
========================================
LOGOUT
========================================
*/

app.post(
    "/api/auth/logout",
    (req, res) => {

        res.clearCookie(
            "netnaira_session"
        );

        return res.json({
            success:
                true,

            message:
                "Logged out successfully."
        });

    }
);


/*
========================================
PROTECTED DASHBOARD
========================================
*/

app.get(
    "/dashboard.html",
    authenticate,
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "dashboard.html"
            )
        );

    }
);

/*
========================================
PROTECTED WITHDRAWAL PAGE
========================================
*/

app.get(
    "/withdraw.html",
    authenticate,
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "withdraw.html"
            )
        );

    }
);


/*
========================================
STATIC FILES
========================================
*/

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/*
========================================
SERVER START
========================================
*/

const server = app.listen(
    PORT,
    async () => {

        console.log("");

        console.log(
            "================================"
        );

        console.log(
            "       NETNAIRA SERVER"
        );

        console.log(
            "================================"
        );

        console.log(
            `Running on port ${PORT}`
        );


        console.log(
            `Telegram verification: ${
                telegramEnabled
                    ? "ENABLED"
                    : "DISABLED"
            }`
        );


        if (
            telegramEnabled &&
            TELEGRAM_ADMIN_USER_ID
        ) {

            console.log(
                "Telegram admin buttons: ENABLED"
            );

        } else {

            console.log(
                "Telegram admin buttons: DISABLED"
            );

        }


        console.log("");


        await setupTelegramUpdates();


        /*
        ========================================
        DAILY EARNINGS SWEEP
        ========================================

        Run once immediately (catches up any
        plans that were due while the server
        was offline), then keep checking every
        15 minutes. Cheap no-op for plans that
        are already paid up for today.
        ========================================
        */

        await runDailyEarningsSweep();

        setInterval(
            runDailyEarningsSweep,
            15 * 60 * 1000
        );

        console.log(
            "Daily earnings sweep: RUNNING (every 15 min)"
        );

        console.log("");

    }
);


/*
========================================
KEEP-ALIVE TIMEOUTS
========================================

Node's defaults (keepAliveTimeout: 5s) are
shorter than how long a browser (Chrome in
particular) will hold an idle connection
open and try to reuse it.

If a user sits on a page for more than 5
seconds before submitting, Node has already
closed the socket server-side, but Chrome
tries to reuse it anyway - the request dies
instantly client-side as "Failed to fetch".
Refreshing the page opens a fresh connection,
which is why it "just works" the second time.

Raising these well above any realistic idle
time (and above any proxy/load balancer
timeout in front of this server on Render)
fixes it. headersTimeout must always be
greater than keepAliveTimeout.
========================================
*/

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;





