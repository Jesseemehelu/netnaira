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

    // ADMIN bot: used for deposit/withdrawal notifications and admin approval buttons.
    const TELEGRAM_ADMIN_BOT_TOKEN =
        TELEGRAM_BOT_TOKEN;

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
        process.env.TELEGRAM_WEBAPP_BOT_TOKEN;

    // USER/Web App bot: this is the bot users message with /start, /deposit, /plans, etc.
    const TELEGRAM_USER_BOT_TOKEN =
        TELEGRAM_WEBAPP_BOT_TOKEN;

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
            "WARNING: TELEGRAM_WEBAPP_BOT_TOKEN is not set. The USER/Web App bot will fall back to the admin bot token."
        );
        console.warn("Set TELEGRAM_WEBAPP_BOT_TOKEN to the token of the bot users should message.");
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

    There are two kinds of referral link, and
    both work the same way once someone uses one:

    1. REFER PAGE (refer.html, /api/referrals)
       shares the Mini App link:

           https://t.me/<bot>/<shortname>?startapp=<username>

       Telegram opens the Web App straight away
       and auth.html forwards start_param as `ref`
       to POST /api/auth/telegram.

    2. BOT's "👥 Referral" message shares the bot
       deep link:

           https://t.me/<bot>?start=<username>

       Telegram sends the bot "/start <username>",
       which getOrCreateTelegramBotUser reads.

    Either way, a brand-new account is tied to the
    referrer, the referrer is credited
    REFERRAL_BONUS once (credit_referral_bonus),
    and the referrer is sent a Telegram message
    right away (notifyReferrerOfNewReferral).
    Existing users opening a link change nothing.
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
    Referral link that opens the BOT. Usernames
    are [a-z0-9_] only, so they're always valid
    Telegram start parameters.
    */
    function telegramBotReferralLink(username) {
        return `https://t.me/${TELEGRAM_WEBAPP_BOT_USERNAME}?start=${encodeURIComponent(username || "")}`;
    }

    /*
    Referral link that opens the Web App (Mini
    App) directly. Used by the refer page.
    */
    function telegramWebAppReferralLink(username) {
        return `https://t.me/${TELEGRAM_WEBAPP_BOT_USERNAME}/${TELEGRAM_WEBAPP_SHORT_NAME}?startapp=${encodeURIComponent(username || "")}`;
    }

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

    const WELCOME_BONUS = 1000;

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

                try {
                    const { data: withdrawalRow } = await supabase
                        .from("withdrawal_requests")
                        .select("user_id")
                        .eq("id", withdrawalId)
                        .maybeSingle();
                    if (withdrawalRow?.user_id) {
                        const { data: withdrawalUser } = await supabase
                            .from("users")
                            .select("telegram_id")
                            .eq("id", withdrawalRow.user_id)
                            .maybeSingle();
                        if (withdrawalUser?.telegram_id) {
                            await sendTelegramUserMessage(
                                withdrawalUser.telegram_id,
                                `✅ *Withdrawal approved!*\n\n₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been approved for payout.\n\nRemaining balance: *${telegramMoney(newBalance)}*`,
                                { parse_mode: "Markdown", reply_markup: telegramBotMainMenuInline() }
                            );
                        }
                    }
                } catch (notifyError) {
                    console.error("Withdrawal approval user notification error:", notifyError);
                }

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

    Every user is reached, however many there
    are (recipients are loaded in pages of 1000).

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

            /*
            Every user with a linked Telegram account.
            Paged (1000 at a time) because Supabase
            returns at most 1000 rows per request, so
            a single query silently dropped everyone
            past the first 1000 users.
            */

            let recipients;

            try {

                recipients =
                    await fetchAllBotRecipientIds();

            } catch (error) {

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



    /*
    ========================================
    WITHDRAWAL HIGHLIGHT (every 3 hours)
    ========================================

    Every 3 hours the bot sends every user
    a "Withdrawal Highlight" message, e.g.

        Withdrawal Highlight 👇
        User - rig****6536 withdrew 765,500 naira

        Deposit, activate a plan and start
        withdrawing daily.

        [ 💳 Deposit Now ]  [ 📈 View Plans ]

    - Username: consonant + vowel + another
      consonant, then ****, then 4 random digits.
    - Amount: random between ₦300,000 and
      ₦1,200,000 (in steps of ₦500).
    - No repeats: a username is never used
      twice, and an amount isn't reused until
      every possible amount has been shown once.
    - Timing: runs at fixed 3-hour marks on the
      clock (00:00, 03:00, 06:00 ... UTC, which is
      01:00, 04:00, 07:00 ... in Nigeria), not
      "3 hours after boot". A restart or a
      redeploy therefore never spams users with
      an extra message or resets the schedule.
    - Sent from the user bot as a normal message,
      so it pings the user.
    - Turn the whole thing off by setting the env
      var WITHDRAWAL_HIGHLIGHTS_ENABLED=false.
    ========================================
    */

    const HIGHLIGHT_INTERVAL_MS =
        3 * 60 * 60 * 1000;

    const HIGHLIGHT_MIN_AMOUNT =
        300000;

    const HIGHLIGHT_MAX_AMOUNT =
        1200000;

    const HIGHLIGHT_AMOUNT_STEP =
        500;

    const HIGHLIGHT_CONSONANTS =
        "bcdfghjklmnpqrstvwxyz".split("");

    const HIGHLIGHT_VOWELS =
        "aeiou".split("");

    const usedHighlightUsernames =
        new Set();

    const usedHighlightAmounts =
        new Set();

    let highlightRunning =
        false;

    let lastHighlightSlot =
        null;

    function pickRandom(list) {

        return list[
            crypto.randomInt(list.length)
        ];

    }

    /*
    e.g. "rig****6536": consonant, vowel, a
    different consonant, ****, 4 random digits.
    */

    function generateHighlightUsername() {

        for (let attempt = 0; attempt < 200; attempt++) {

            const first =
                pickRandom(HIGHLIGHT_CONSONANTS);

            const vowel =
                pickRandom(HIGHLIGHT_VOWELS);

            let second =
                pickRandom(HIGHLIGHT_CONSONANTS);

            while (second === first) {
                second =
                    pickRandom(HIGHLIGHT_CONSONANTS);
            }

            const digits =
                String(
                    crypto.randomInt(10000)
                ).padStart(4, "0");

            const username =
                `${first}${vowel}${second}****${digits}`;

            if (!usedHighlightUsernames.has(username)) {

                usedHighlightUsernames.add(username);

                return username;

            }

        }

        // ~21 million combinations, so this is practically unreachable.
        usedHighlightUsernames.clear();

        return generateHighlightUsername();

    }

    function generateHighlightAmount() {

        const slots =
            Math.floor(
                (
                    HIGHLIGHT_MAX_AMOUNT -
                    HIGHLIGHT_MIN_AMOUNT
                ) / HIGHLIGHT_AMOUNT_STEP
            ) + 1;

        // Every amount has been shown once: start a fresh round.
        if (usedHighlightAmounts.size >= slots) {
            usedHighlightAmounts.clear();
        }

        let amount;

        do {

            amount =
                HIGHLIGHT_MIN_AMOUNT +
                crypto.randomInt(slots) *
                HIGHLIGHT_AMOUNT_STEP;

        } while (usedHighlightAmounts.has(amount));

        usedHighlightAmounts.add(amount);

        return amount;

    }

    /*
    Every user who has a Telegram account linked.
    Paged, because Supabase returns at most 1000
    rows per request.
    */

    async function fetchAllBotRecipientIds() {

        const PAGE_SIZE =
            1000;

        const ids =
            new Set();

        for (let from = 0; ; from += PAGE_SIZE) {

            const {
                data,
                error
            } = await supabase
                .from("users")
                .select("telegram_id")
                .not("telegram_id", "is", null)
                .order("id", { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                throw error;
            }

            for (const row of data || []) {

                if (row.telegram_id) {
                    ids.add(String(row.telegram_id));
                }

            }

            if (!data || data.length < PAGE_SIZE) {
                break;
            }

        }

        return [...ids];

    }

    async function sendWithdrawalHighlight() {

        if (!TELEGRAM_USER_BOT_TOKEN) {
            return;
        }

        if (highlightRunning) {

            console.warn(
                "Withdrawal highlight: previous send still running, skipping."
            );

            return;

        }

        highlightRunning =
            true;

        try {

            const recipients =
                await fetchAllBotRecipientIds();

            if (!recipients.length) {
                return;
            }

            const username =
                generateHighlightUsername();

            const amount =
                generateHighlightAmount();

            // HTML mode, because "****" would break Markdown.
            const text =
                `<b>Withdrawal Highlight</b> 👇\n` +
                `User - ${username} withdrew ` +
                `<b>${amount.toLocaleString("en-US")} naira</b>\n\n` +
                `Deposit, activate a plan and start withdrawing daily.`;

            const replyMarkup = {
                inline_keyboard: [[
                    {
                        text:
                            "💳 Deposit Now",

                        web_app: {
                            url:
                                `${APP_BASE_URL}/auth.html?next=deposit.html`
                        }
                    },
                    {
                        text:
                            "📈 View Plans",

                        callback_data:
                            "bot:plans"
                    }
                ]]
            };

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

                                        text,

                                        parse_mode:
                                            "HTML",

                                        reply_markup:
                                            replyMarkup
                                    },
                                    TELEGRAM_USER_BOT_TOKEN
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

            console.log(
                `Withdrawal highlight sent (${username} / ${amount}): ${sent} delivered, ${failed} failed`
            );

        } catch (error) {

            console.error(
                "Withdrawal highlight error:",
                error.message || error
            );

        } finally {

            highlightRunning =
                false;

        }

    }

    /*
    Sleeps until the next 3-hour mark on the
    clock, sends, then schedules the following one.
    */

    function scheduleNextWithdrawalHighlight() {

        const delay =
            Math.max(
                1000,
                HIGHLIGHT_INTERVAL_MS -
                (Date.now() % HIGHLIGHT_INTERVAL_MS)
            );

        setTimeout(
            async () => {

                // Which 3-hour mark this is (timers can fire a hair early).
                const slot =
                    Math.round(
                        Date.now() / HIGHLIGHT_INTERVAL_MS
                    );

                if (slot !== lastHighlightSlot) {

                    lastHighlightSlot =
                        slot;

                    await sendWithdrawalHighlight();

                }

                scheduleNextWithdrawalHighlight();

            },
            delay
        );

    }

    function startWithdrawalHighlights() {

        if (
            String(
                process.env.WITHDRAWAL_HIGHLIGHTS_ENABLED
            ).toLowerCase() === "false"
        ) {

            console.log(
                "Withdrawal highlights: DISABLED"
            );

            return;

        }

        if (!TELEGRAM_USER_BOT_TOKEN) {

            console.log(
                "Withdrawal highlights: skipped (no user bot token)"
            );

            return;

        }

        scheduleNextWithdrawalHighlight();

        console.log(
            "Withdrawal highlights: RUNNING (every 3 hours)"
        );

    }



    /*
    ========================================
    NORMAL USER TELEGRAM BOT
    ========================================

    The same Telegram bot can now work as a
    normal bot as well as the Mini App launcher.

    Users can:
    - open the Web App
    - check balance
    - view/activate earning plans
    - view referral information
    - get deposit instructions
    - open withdrawal flow
    - contact support

    The bot uses the SAME Supabase users table,
    wallet balance and plan activation RPC as
    the Web App. No fake balances or separate
    wallet system is created.
    ========================================
    */

    const TELEGRAM_SUPPORT_URL =
        process.env.TELEGRAM_SUPPORT_URL ||
        "https://t.me/netnaira";

    const TELEGRAM_DEPOSIT_ACCOUNT =
        process.env.TELEGRAM_DEPOSIT_ACCOUNT ||
        "6682064981";

    const TELEGRAM_DEPOSIT_ACCOUNT_MASKED =
        process.env.TELEGRAM_DEPOSIT_ACCOUNT_MASKED ||
        "668****981";

    const TELEGRAM_DEPOSIT_ACCOUNT_NAME =
        process.env.TELEGRAM_DEPOSIT_ACCOUNT_NAME ||
        "Vtuexpress Jes (paymentpoint)";

    const TELEGRAM_DEPOSIT_BANK =
        process.env.TELEGRAM_DEPOSIT_BANK ||
        "PalmPay";

    const TELEGRAM_BOT_MENU = {
        keyboard: [
            [
                {
                    text: "🚀 Open Web App"
                },
                {
                    text: "💰 Balance"
                }
            ],
            [
                {
                    text: "📈 Plans"
                },
                {
                    text: "💳 Deposit"
                }
            ],
            [
                {
                    text: "💸 Withdraw"
                },
                {
                    text: "👥 Referral"
                }
            ],
            [
                {
                    text: "🆘 Support"
                }
            ]
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Choose an option..."
    };

    const telegramBotSessions = new Map();

    function telegramBotSessionKey(messageOrId) {
        return String(
            typeof messageOrId === "object"
                ? (messageOrId?.from?.id || messageOrId?.chat?.id || "")
                : (messageOrId || "")
        );
    }

    function setTelegramBotSession(telegramId, session) {
        if (!telegramId) return;
        telegramBotSessions.set(String(telegramId), session);
    }

    function getTelegramBotSession(telegramId) {
        return telegramBotSessions.get(String(telegramId)) || null;
    }

    function clearTelegramBotSession(telegramId) {
        telegramBotSessions.delete(String(telegramId));
    }

    async function sendTelegramBotCancelPrompt(chatId, text, extra = {}) {
        return sendTelegramUserMessage(chatId, text, {
            ...extra,
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "❌ Cancel",
                        callback_data: "bot:cancel"
                    }],
                    [{
                        text: "🚀 Use Web App instead",
                        web_app: {
                            url: `${APP_BASE_URL}/auth.html`
                        }
                    }]
                ]
            }
        });
    }

    function telegramMoney(amount) {
        return `₦${Number(amount || 0).toLocaleString("en-NG")}`;
    }

    function telegramBotChatId(message) {
        return String(message?.chat?.id || "");
    }

    async function sendTelegramUserMessage(chatId, text, extra = {}) {
        if (!TELEGRAM_USER_BOT_TOKEN || !chatId) return null;

        const payload = {
            chat_id: chatId,
            text,
            parse_mode: extra.parse_mode || undefined,
            disable_web_page_preview: extra.disable_web_page_preview !== false,
            reply_markup: extra.reply_markup || TELEGRAM_BOT_MENU
        };

        try {
            return await telegramApi(
                "sendMessage",
                payload,
                TELEGRAM_USER_BOT_TOKEN
            );
        } catch (error) {
            // Never let malformed Markdown prevent the user from receiving a response.
            if (payload.parse_mode && /can't parse entities|parse entities/i.test(error.message || "")) {
                delete payload.parse_mode;
                console.warn("Telegram message parse failed; retrying without parse_mode.");
                return telegramApi("sendMessage", payload, TELEGRAM_USER_BOT_TOKEN);
            }
            throw error;
        }
    }

    /*
    Tell a user, in the bot, that their deposit
    was submitted and is waiting for approval.

    Best-effort only: never throws, so a Telegram
    hiccup can never affect the deposit itself.
    Skipped silently for users with no linked
    Telegram account (e.g. website email signups).
    */
    async function notifyUserDepositPending(
        telegramId,
        amount
    ) {
        try {
            if (!telegramId) return;

            await sendTelegramUserMessage(
                String(telegramId),
                `⏳ *Deposit submitted*\n\n` +
                `Amount: *${telegramMoney(amount)}*\n` +
                `Status: *Pending approval*\n\n` +
                `We'll notify you as soon as it's reviewed.`,
                { parse_mode: "Markdown" }
            );
        } catch (notifyError) {
            console.error(
                "Deposit pending notify error:",
                notifyError.message || notifyError
            );
        }
    }

    /*
    Tell a referrer, via the user bot, that
    someone just joined with their link and that
    their referral balance went up.

    Best-effort only: never throws, never blocks
    signup. Skipped silently if the referrer has
    no linked Telegram account (e.g. they signed
    up on the website with email/password).
    */
    async function notifyReferrerOfNewReferral(
        referrerId,
        referredName
    ) {
        try {
            if (!referrerId) return;

            const {
                data: referrerRow,
                error: referrerError
            } = await supabase
                .from("users")
                .select("telegram_id, referral_balance")
                .eq("id", referrerId)
                .maybeSingle();

            if (referrerError) {
                console.error(
                    "Referral notify: referrer lookup error:",
                    referrerError
                );
                return;
            }

            if (!referrerRow?.telegram_id) return;

            const safeName =
                String(referredName || "Someone").trim() ||
                "Someone";

            await sendTelegramUserMessage(
                String(referrerRow.telegram_id),
                `🎉 ${safeName} joined using your referral link!\n\n` +
                `💰 Referral balance increased +${telegramMoney(REFERRAL_BONUS)}\n` +
                `👥 Referral balance: ${telegramMoney(referrerRow.referral_balance)}`
            );
        } catch (notifyError) {
            console.error(
                "Referral notify error:",
                notifyError.message || notifyError
            );
        }
    }

    async function telegramBotUserById(telegramId) {
        if (!telegramId) return null;

        const {
            data,
            error
        } = await supabase
            .from("users")
            .select(
                "id, full_name, username, telegram_id, telegram_username, balance, total_earned, referral_balance"
            )
            .eq("telegram_id", String(telegramId))
            .maybeSingle();

        if (error) {
            console.error(
                "Telegram bot user lookup error:",
                error
            );
            throw error;
        }

        return data || null;
    }

    /*
    Create the same account that Telegram Mini App
    authentication creates. This means a user can
    start with the normal bot and does not have to
    open the Web App first.

    The optional /start parameter is treated as the
    existing username-based referral code.
    */
    async function getOrCreateTelegramBotUser(
        tgUser,
        startParam = ""
    ) {
        const telegramId = String(tgUser?.id || "");

        if (!telegramId) return null;

        const existing =
            await telegramBotUserById(telegramId);

        if (existing) return existing;

        const base =
            (
                tgUser.username ||
                tgUser.first_name ||
                "user"
            )
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "")
                .slice(0, 15) || "user";

        let candidateUsername = base;
        let suffix = 0;

        while (true) {
            const {
                data: taken,
                error: usernameLookupError
            } = await supabase
                .from("users")
                .select("id")
                .eq("username", candidateUsername)
                .maybeSingle();

            if (usernameLookupError) {
                throw usernameLookupError;
            }

            if (!taken) break;

            suffix += 1;
            candidateUsername =
                `${base}${suffix}`;
        }

        let referrer = null;

        const cleanRef =
            typeof startParam === "string"
                ? startParam
                    .trim()
                    .replace(/^@/, "")
                    .toLowerCase()
                : "";

        if (cleanRef) {
            const {
                data: referrerRow,
                error: referrerError
            } = await supabase
                .from("users")
                .select("id, username")
                .eq("username", cleanRef)
                .maybeSingle();

            if (referrerError) {
                console.error(
                    "Telegram bot referrer lookup error:",
                    referrerError
                );
            } else {
                referrer = referrerRow;
            }
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
                    true,

                referred_by:
                    referrer
                        ? referrer.id
                        : null
            })
            .select("id")
            .single();

        if (insertError) {
            /*
            A concurrent Mini App/bot start may have
            created the same Telegram user first.
            Re-read before failing.
            */
            const raceUser =
                await telegramBotUserById(telegramId);

            if (raceUser) {
                return raceUser;
            }

            throw insertError;
        }

        // Notify the admin for every brand-new Telegram bot account.
        if (telegramEnabled) {
            const signupTime = new Date(newUser.created_at || Date.now()).toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
            const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || candidateUsername;
            telegramApi("sendMessage", {
                chat_id: TELEGRAM_ADMIN_CHAT_ID,
                text: `🆕 NEW TELEGRAM USER\n\n━━━━━━━━━━━━━━━━━━\n\n👤 Name: ${displayName}\n🔗 Username: @${candidateUsername}\n📱 Telegram: ${tgUser.username ? "@" + tgUser.username : "No username"}\n🆔 Telegram ID: ${telegramId}\n💰 Starting balance: ${telegramMoney(WELCOME_BONUS)}\n👥 Referred by: ${referrer ? "@" + referrer.username : "None"}\n🕐 Joined: ${signupTime}`
            }, TELEGRAM_ADMIN_BOT_TOKEN).catch((telegramError) => {
                console.error("Telegram bot new-user notification error:", telegramError.message);
            });
        }

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
                            newUser.id,

                        p_amount:
                            REFERRAL_BONUS
                    }
                );

            if (referralError) {
                console.error(
                    "Telegram bot referral bonus error:",
                    referralError
                );
            } else if (referralResult?.success === true) {
                // Tell the referrer right away (fire-and-forget).
                notifyReferrerOfNewReferral(
                    referrer.id,
                    tgUser.first_name ||
                        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") ||
                        candidateUsername
                );
            } else {
                console.warn(
                    "Telegram bot referral bonus not credited:",
                    referralResult?.message
                );
            }
        }

        return telegramBotUserById(telegramId);
    }

    function telegramBotMainMenuInline() {
        return {
            inline_keyboard: [
                [
                    {
                        text: "🚀 Open Web App",
                        web_app: {
                            url:
                                `${APP_BASE_URL}/auth.html`
                        }
                    }
                ],
                [
                    {
                        text: "💰 Balance",
                        callback_data:
                            "bot:balance"
                    },
                    {
                        text: "📈 Plans",
                        callback_data:
                            "bot:plans"
                    }
                ],
                [
                    {
                        text: "💳 Deposit",
                        callback_data:
                            "bot:deposit"
                    },
                    {
                        text: "💸 Withdraw",
                        callback_data:
                            "bot:withdraw"
                    }
                ],
                [
                    {
                        text: "👥 Referral",
                        callback_data:
                            "bot:referral"
                    },
                    {
                        text: "🆘 Support",
                        url:
                            TELEGRAM_SUPPORT_URL
                    }
                ]
            ]
        };
    }

    async function sendTelegramBotHome(message, isNewUser = false) {
        const chatId =
            telegramBotChatId(message);

        const firstName =
            message?.from?.first_name ||
            "there";

        const welcomeText =
            isNewUser
                ? `🎉 Welcome to Netnaira, ${firstName}!\n\nYour account has been created and your ${telegramMoney(WELCOME_BONUS)} welcome bonus has been credited.\n\n📣 Join our official Telegram announcement channel for important updates, announcements and promos:\nt.me/netnairaupdates\n\nUse the buttons below to manage your account or open the Web App.`
                : `👋 Welcome back, ${firstName}!\n\nChoose what you want to do below. You can use Netnaira directly in this bot or open the full Web App.`;

        await sendTelegramUserMessage(
            chatId,
            welcomeText,
            {
                reply_markup:
                    TELEGRAM_BOT_MENU
            }
        );

        await sendTelegramUserMessage(
            chatId,
            "Quick actions:",
            {
                reply_markup:
                    telegramBotMainMenuInline()
            }
        );
    }

    async function sendTelegramBotBalance(user, chatId) {
        if (!user) {
            await sendTelegramUserMessage(
                chatId,
                "I couldn't find your Netnaira account. Tap 🚀 Open Web App to create or connect your account."
            );
            return;
        }

        let activePlanText =
            "No active earning plan";

        const {
            data: activePlanRow
        } = await supabase
            .from("user_plans")
            .select(
                "plan_name, daily_income, days_paid, duration_days"
            )
            .eq(
                "user_id",
                user.id
            )
            .eq(
                "status",
                "active"
            )
            .order(
                "started_at",
                {
                    ascending: false
                }
            )
            .limit(1)
            .maybeSingle();

        if (activePlanRow) {
            activePlanText =
                `${activePlanRow.plan_name} • ${telegramMoney(activePlanRow.daily_income)}/day • ${activePlanRow.days_paid || 0}/${activePlanRow.duration_days || 0} days`;
        }

        await sendTelegramUserMessage(
            chatId,
            `💰 *Your Netnaira Balance*\n\n` +
            `Available balance: *${telegramMoney(user.balance)}*\n` +
            `Total earned: *${telegramMoney(user.total_earned)}*\n` +
            `Referral balance: *${telegramMoney(user.referral_balance)}*\n\n` +
            `📈 Active plan:\n${activePlanText}`,
            {
                parse_mode:
                    "Markdown",
                reply_markup:
                    telegramBotMainMenuInline()
            }
        );
    }

    function telegramBotPlansKeyboard() {
        const names =
            Object.keys(EARNING_PLANS);

        const rows = [];

        for (
            let i = 0;
            i < names.length;
            i += 2
        ) {
            const row = [];

            for (
                let j = i;
                j < Math.min(i + 2, names.length);
                j++
            ) {
                const name = names[j];
                const plan = EARNING_PLANS[name];

                row.push({
                    text:
                        `${name} • ${telegramMoney(plan.amount)}`,
                    callback_data:
                        `bot:plan:${name}`
                });
            }

            rows.push(row);
        }

        rows.push([
            {
                text:
                    "🚀 Open Web App",
                web_app: {
                    url:
                        `${APP_BASE_URL}/auth.html`
                }
            }
        ]);

        return {
            inline_keyboard:
                rows
        };
    }

    async function sendTelegramBotPlans(chatId) {
        let text =
            "📈 *Netnaira Earning Plans*\n\n";

        for (const [name, plan] of Object.entries(EARNING_PLANS)) {
            text +=
                `*${name}*\n` +
                `Invest: ${telegramMoney(plan.amount)}\n` +
                `Daily: ${telegramMoney(plan.daily)}\n` +
                `30-day total: ${telegramMoney(plan.total)}\n\n`;
        }

        text +=
            "Tap a plan below to view its details and activate it from your Telegram chat.";

        await sendTelegramUserMessage(
            chatId,
            text,
            {
                parse_mode:
                    "Markdown",
                reply_markup:
                    telegramBotPlansKeyboard()
            }
        );
    }

    async function handleTelegramBotPlanCallback(callbackQuery, user, botToken = TELEGRAM_USER_BOT_TOKEN) {
        const data =
            callbackQuery?.data || "";

        const match =
            data.match(
                /^bot:plan:(.+)$/i
            );

        if (!match) return false;

        const planName =
            match[1];

        const plan =
            EARNING_PLANS[planName];

        if (!plan) {
            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "That plan is not available.",
                    show_alert:
                        true
                },
                botToken
            );

            return true;
        }

        if (!user) {
            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "Account not found. Please use /start again.",
                    show_alert:
                        true
                },
                botToken
            );

            return true;
        }

        await telegramApi(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id
            },
            botToken
        );

        await telegramApi(
            "sendMessage",
            {
                chat_id:
                    callbackQuery.message.chat.id,

                text:
                    `📈 *${planName} Plan*\n\n` +
                    `Investment: *${telegramMoney(plan.amount)}*\n` +
                    `Daily income: *${telegramMoney(plan.daily)}*\n` +
                    `Duration: *${plan.durationDays} days*\n` +
                    `Total expected return: *${telegramMoney(plan.total)}*\n\n` +
                    `Your current balance is *${telegramMoney(user.balance)}*.\n\n` +
                    (Number(user.balance || 0) >= plan.amount
                        ? "You have enough balance to activate this plan."
                        : "You don't currently have enough balance. Deposit funds first."),
                parse_mode:
                    "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    Number(user.balance || 0) >= plan.amount
                                        ? "✅ Activate Plan"
                                        : "💳 Deposit Funds",
                                callback_data:
                                    Number(user.balance || 0) >= plan.amount
                                        ? `bot:activate:${planName}`
                                        : "bot:deposit"
                            }
                        ],
                        [
                            {
                                text:
                                    "⬅️ Back to Plans",
                                callback_data:
                                    "bot:plans"
                            }
                        ]
                    ]
                }
            },
            botToken
        );

        return true;
    }

    async function handleTelegramBotActivateCallback(callbackQuery, user, botToken = TELEGRAM_USER_BOT_TOKEN) {
        const data =
            callbackQuery?.data || "";

        const match =
            data.match(
                /^bot:activate:(.+)$/i
            );

        if (!match) return false;

        const planName =
            match[1];

        const plan =
            EARNING_PLANS[planName];

        if (!plan || !user) {
            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "Unable to activate this plan.",
                    show_alert:
                        true
                },
                botToken
            );

            return true;
        }

        try {
            const {
                data,
                error
            } = await supabase
                .rpc(
                    "activate_plan",
                    {
                        p_user_id:
                            user.id,

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
                throw error;
            }

            if (!data || data.success === false) {
                const message =
                    data?.message ||
                    "Unable to activate this plan.";

                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id,
                        text:
                            message,
                        show_alert:
                            true
                    },
                    botToken
                );

                return true;
            }

            const newBalance =
                Number(
                    data.new_balance ??
                    Number(user.balance || 0) - plan.amount
                );

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "Plan activated successfully!"
                },
                botToken
            );

            await sendTelegramUserMessage(
                callbackQuery.message.chat.id,
                `✅ *${planName} Plan Activated!*\n\n` +
                `Investment: *${telegramMoney(plan.amount)}*\n` +
                `Daily income: *${telegramMoney(plan.daily)}*\n` +
                `Duration: *${plan.durationDays} days*\n\n` +
                `New balance: *${telegramMoney(newBalance)}*\n\n` +
                `Your daily earnings are processed automatically.`,
                {
                    parse_mode:
                        "Markdown",
                    reply_markup:
                        telegramBotMainMenuInline()
                }
            );

        } catch (error) {
            console.error(
                "Telegram bot plan activation error:",
                error
            );

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "Unable to activate the plan right now.",
                    show_alert:
                        true
                },
                botToken
            );
        }

        return true;
    }

    async function sendTelegramBotDeposit(chatId) {
        await sendTelegramUserMessage(
            chatId,
            `💳 *Deposit*\n\nTap below to pay and submit your deposit for review.`,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{
                        text: "💳 Open Deposit Page",
                        web_app: { url: `${APP_BASE_URL}/auth.html?next=deposit.html` }
                    }]]
                }
            }
        );
    }

    async function beginTelegramBotDeposit(chatId, telegramId) {
        const existing = await telegramBotUserById(telegramId);
        if (!existing) {
            await sendTelegramUserMessage(chatId, "Please send /start first so I can connect your Netnaira account.");
            return;
        }

        const { data: pending, error } = await supabase
            .from("deposit_requests")
            .select("id, amount, status")
            .eq("user_id", existing.id)
            .eq("status", "pending")
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        if (pending) {
            await sendTelegramUserMessage(
                chatId,
                `⏳ You already have a pending deposit of *${telegramMoney(pending.amount)}*. Please wait for it to be reviewed.`,
                { parse_mode: "Markdown", reply_markup: telegramBotMainMenuInline() }
            );
            return;
        }

        setTelegramBotSession(telegramId, {
            type: "deposit",
            step: "amount"
        });

        await sendTelegramBotCancelPrompt(
            chatId,
            `💵 *Deposit amount*\n\nHow much did you deposit?\n\nMinimum: *${telegramMoney(3000)}*\nMaximum: *₦10,000,000*\n\nSend the amount as a number, for example: *5000*`,
            { parse_mode: "Markdown" }
        );
    }

    async function submitTelegramBotDepositPhoto(message, session) {
        const chatId = telegramBotChatId(message);
        const telegramId = String(message.from.id);
        const photo = Array.isArray(message.photo) && message.photo.length
            ? message.photo[message.photo.length - 1]
            : null;

        if (!photo) {
            await sendTelegramUserMessage(chatId, "Please send the payment screenshot as a photo.");
            return;
        }

        const amount = Number(session.amount);
        if (!Number.isFinite(amount) || amount < 3000 || amount > 10000000) {
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(chatId, "That deposit session is no longer valid. Tap 💳 Deposit and start again.");
            return;
        }

        const user = await telegramBotUserById(telegramId);
        if (!user) {
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(chatId, "I couldn't find your Netnaira account. Send /start and try again.");
            return;
        }

        const { data: pending, error: pendingError } = await supabase
            .from("deposit_requests")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "pending")
            .limit(1)
            .maybeSingle();

        if (pendingError) throw pendingError;
        if (pending) {
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(chatId, "⏳ You already have a deposit pending review.", { reply_markup: telegramBotMainMenuInline() });
            return;
        }

        const { data: deposit, error: insertError } = await supabase
            .from("deposit_requests")
            .insert({
                user_id: user.id,
                amount,
                status: "pending"
            })
            .select("id, amount, created_at")
            .single();

        if (insertError || !deposit) throw insertError || new Error("Deposit insert failed");

        try {
            const fileInfo = await telegramApi(
                "getFile",
                { file_id: photo.file_id },
                TELEGRAM_BOT_TOKEN
            );

            if (!fileInfo?.ok || !fileInfo.result?.file_path) {
                throw new Error("Telegram could not retrieve the screenshot.");
            }

            const imageResponse = await fetch(
                `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`
            );

            if (!imageResponse.ok) throw new Error("Unable to download Telegram screenshot.");

            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
            const filename = `telegram-deposit-${deposit.id}.${contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"}`;

            const submittedAt = new Date(deposit.created_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
            const caption =
`💰 NEW TELEGRAM DEPOSIT VERIFICATION\n\n━━━━━━━━━━━━━━━━━━\n\n` +
`👤 Name:\n${user.full_name || "Unknown"}\n\n` +
`🔗 Username:\n@${user.username || user.telegram_username || "unknown"}\n\n` +
`🆔 User ID:\n${user.id}\n\n` +
`💵 Amount:\n₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
`🏦 Deposit Account:\n${TELEGRAM_DEPOSIT_ACCOUNT}\n\n` +
`👤 Account Name:\n${TELEGRAM_DEPOSIT_ACCOUNT_NAME}\n\n` +
`🏦 Bank:\n${TELEGRAM_DEPOSIT_BANK}\n\n` +
`📋 Request ID:\n${deposit.id}\n\n` +
`🕐 Submitted:\n${submittedAt}\n\n` +
`━━━━━━━━━━━━━━━━━━\n\n⚠️ STATUS: PENDING REVIEW\n\nVerify the actual payment before approving this deposit.`;

            const form = new FormData();
            form.append("chat_id", TELEGRAM_ADMIN_CHAT_ID);
            form.append("caption", caption);
            form.append("reply_markup", JSON.stringify({
                inline_keyboard: [[
                    { text: "✅ Accept", callback_data: `deposit:approve:${deposit.id}` },
                    { text: "❌ Reject", callback_data: `deposit:reject:${deposit.id}` }
                ]]
            }));
            form.append("photo", new Blob([imageBuffer], { type: contentType }), filename);

            const adminResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
                { method: "POST", body: form }
            );
            const adminData = await adminResponse.json().catch(() => null);

            if (!adminResponse.ok || !adminData?.ok) {
                throw new Error("Telegram admin notification failed.");
            }

            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(
                chatId,
                `✅ *Deposit submitted successfully!*\n\nAmount: *${telegramMoney(amount)}*\nRequest ID: *${deposit.id}*\n\nYour payment screenshot has been sent for review. You will be notified after it is processed.`,
                { parse_mode: "Markdown", reply_markup: telegramBotMainMenuInline() }
            );
        } catch (error) {
            console.error("Telegram-native deposit photo error:", error);
            await supabase
                .from("deposit_requests")
                .update({ status: "telegram_failed" })
                .eq("id", deposit.id)
                .eq("status", "pending");
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(
                chatId,
                "⚠️ I received your request but could not send the screenshot for review. Please try the deposit again or use the Web App.",
                { reply_markup: telegramBotMainMenuInline() }
            );
        }
    }

    async function sendTelegramBotWithdraw(user, chatId) {
        if (!user) {
            await sendTelegramUserMessage(chatId, "I couldn't find your account. Send /start first.");
            return;
        }

        await sendTelegramUserMessage(
            chatId,
            `💸 *Withdraw funds*\n\nAvailable balance: *${telegramMoney(user.balance)}*\nMinimum withdrawal: *${telegramMoney(MIN_WITHDRAWAL)}*\n\nTap *Start Withdrawal* to continue securely in the Netnaira Web App.`,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "🏦 Start Withdrawal",
                            web_app: {
                                url: `${APP_BASE_URL}/auth.html?next=withdraw.html`
                            }
                        }]
                    ]
                }
            }
        );
    }

    async function beginTelegramBotWithdraw(chatId, telegramId) {
        const user = await telegramBotUserById(telegramId);
        if (!user) {
            await sendTelegramUserMessage(chatId, "Please send /start first so I can connect your account.");
            return;
        }

        setTelegramBotSession(telegramId, {
            type: "withdraw",
            step: "bank_name",
            data: {}
        });

        await sendTelegramBotCancelPrompt(
            chatId,
            `🏦 *Bank name*\n\nSend the name of the bank you want the withdrawal paid to.\n\nExample: *PalmPay*`
        );
    }

    async function submitTelegramBotWithdrawal(telegramId, chatId, session, amountText) {
        const amount = Number(String(amountText).replace(/[₦,\s]/g, ""));
        if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL) {
            await sendTelegramUserMessage(chatId, `❌ Enter a whole-naira amount of at least *${telegramMoney(MIN_WITHDRAWAL)}*.`, { parse_mode: "Markdown" });
            return;
        }

        const user = await telegramBotUserById(telegramId);
        if (!user) throw new Error("User account not found.");

        const { count: referralCount, error: referralError } = await supabase
            .from("referral_earnings")
            .select("referred_user_id", { count: "exact", head: true })
            .eq("referrer_id", user.id);
        if (referralError) throw referralError;

        if (Number(referralCount || 0) < MIN_WITHDRAWAL_REFERRALS) {
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(chatId, `❌ You need ${MIN_WITHDRAWAL_REFERRALS} referrals before you can withdraw.`, { reply_markup: telegramBotMainMenuInline() });
            return;
        }

        const balance = Number(user.balance || 0);
        if (amount > balance) {
            await sendTelegramUserMessage(chatId, `❌ Insufficient balance. Your available balance is *${telegramMoney(balance)}*.`, { parse_mode: "Markdown" });
            return;
        }

        const { data: existingPending, error: pendingError } = await supabase
            .from("withdrawal_requests")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "pending")
            .limit(1)
            .maybeSingle();
        if (pendingError) throw pendingError;
        if (existingPending) {
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(chatId, "⏳ You already have a withdrawal request awaiting review.", { reply_markup: telegramBotMainMenuInline() });
            return;
        }

        const bankName = String(session.data.bank_name || "").trim();
        const accountNumber = String(session.data.account_number || "").replace(/\D/g, "");
        const accountName = String(session.data.account_name || "").trim();

        const { error: bankError } = await supabase
            .from("user_bank_accounts")
            .upsert({
                user_id: user.id,
                bank_name: bankName,
                account_number: accountNumber,
                account_name: accountName,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });
        if (bankError) throw bankError;

        const { data: withdrawal, error: insertError } = await supabase
            .from("withdrawal_requests")
            .insert({
                user_id: user.id,
                amount,
                bank_name: bankName,
                account_number: accountNumber,
                account_name: accountName,
                status: "pending"
            })
            .select("id, amount, bank_name, account_number, account_name, created_at")
            .single();
        if (insertError || !withdrawal) throw insertError || new Error("Withdrawal insert failed");

        try {
            await telegramApi("sendMessage", {
                chat_id: TELEGRAM_ADMIN_CHAT_ID,
                text:
`💸 NEW TELEGRAM WITHDRAWAL REQUEST\n\n` +
`💰 Amount:\n₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
`👤 User:\n${user.full_name || "Unknown"}\n\n` +
`🔹 Username:\n@${user.username || user.telegram_username || "unknown"}\n\n` +
`🏦 Bank:\n${bankName}\n\n` +
`🔢 Account Number:\n${accountNumber}\n\n` +
`👤 Account Name:\n${accountName}\n\n` +
`🆔 User ID:\n${user.id}\n\n` +
`📋 Request ID:\n${withdrawal.id}\n\n` +
`━━━━━━━━━━━━━━━━━━\n\nReview this request carefully before approving.`,
                reply_markup: {
                    inline_keyboard: [[
                        { text: "✅ ACCEPT", callback_data: `withdrawal:approve:${withdrawal.id}` },
                        { text: "❌ REJECT", callback_data: `withdrawal:reject:${withdrawal.id}` }
                    ]]
                }
            });

            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(
                chatId,
                `✅ *Withdrawal request submitted!*\n\nAmount: *${telegramMoney(amount)}*\nBank: *${bankName}*\nAccount: *${accountNumber}*\nName: *${accountName}*\n\nYour request is now pending review.`,
                { parse_mode: "Markdown", reply_markup: telegramBotMainMenuInline() }
            );
        } catch (error) {
            console.error("Telegram-native withdrawal notification error:", error);
            clearTelegramBotSession(telegramId);
            await sendTelegramUserMessage(
                chatId,
                "⚠️ Your withdrawal was saved, but I could not notify the admin. Please contact support before submitting another withdrawal.",
                { reply_markup: telegramBotMainMenuInline() }
            );
        }
    }

    async function sendTelegramBotReferral(user, chatId) {
        if (!user) {
            await sendTelegramUserMessage(
                chatId,
                "I couldn't find your account. Use /start again."
            );
            return;
        }

        const {
            count: referralCount,
            error: referralCountError
        } = await supabase
            .from("referral_earnings")
            .select("referred_user_id", {
                count: "exact",
                head: true
            })
            .eq("referrer_id", user.id);

        if (referralCountError) {
            console.error(
                "Telegram referral count error:",
                referralCountError
            );
        }

        const count = Number(referralCount || 0);
        const referralBalance = Number(user.referral_balance || 0);
        const referralCode = user.username || "";

        const referralLink =
            telegramBotReferralLink(referralCode);

        await sendTelegramUserMessage(
            chatId,
            `👥 *Referral Program*\n\n` +
            `🎁 Earn *₦500 for every referral* who signs up with your link.\n\n` +
            `💰 Referral balance: *${telegramMoney(referralBalance)}*\n` +
            `👥 Referral count: *${count}*\n` +
            `🔗 Your referral link:\n${referralLink}\n\n` +
            `Share your link with friends and earn *₦500* for each successful referral.\n\n` +
            `Manage and withdraw your referral balance from the Referral page in the Web App.`,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "💸 Open Referral Page",
                            web_app: {
                                url: `${APP_BASE_URL}/auth.html?next=refer.html`
                            }
                        }]
                    ]
                }
            }
        );
    }

    async function handleTelegramBotCallback(callbackQuery, botToken = TELEGRAM_USER_BOT_TOKEN) {
        const data =
            callbackQuery?.data || "";

        if (!data.startsWith("bot:")) {
            return false;
        }

        const telegramId =
            String(
                callbackQuery.from?.id || ""
            );

        let user = null;

        try {
            user =
                await telegramBotUserById(
                    telegramId
                );

            if (data === "bot:balance") {
                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id
                    },
                    botToken
                );

                await sendTelegramBotBalance(
                    user,
                    callbackQuery.message.chat.id
                );

                return true;
            }

            if (data === "bot:plans") {
                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id
                    },
                    botToken
                );

                await sendTelegramBotPlans(
                    callbackQuery.message.chat.id
                );

                return true;
            }

            if (data === "bot:deposit") {
                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id
                    },
                    botToken
                );

                await sendTelegramBotDeposit(
                    callbackQuery.message.chat.id
                );

                return true;
            }

            if (data === "bot:deposit_start") {
                await telegramApi("answerCallbackQuery", { callback_query_id: callbackQuery.id }, botToken);
                await sendTelegramBotDeposit(callbackQuery.message.chat.id);
                return true;
            }

            if (data === "bot:withdraw_start") {
                await telegramApi("answerCallbackQuery", { callback_query_id: callbackQuery.id }, botToken);
                await sendTelegramBotWithdraw(user, callbackQuery.message.chat.id);
                return true;
            }

            if (data === "bot:cancel") {
                clearTelegramBotSession(telegramId);
                await telegramApi("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "Cancelled." }, botToken);
                await sendTelegramUserMessage(callbackQuery.message.chat.id, "❌ Current action cancelled.", { reply_markup: telegramBotMainMenuInline() });
                return true;
            }

            if (data === "bot:withdraw") {
                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id
                    },
                    botToken
                );

                await sendTelegramBotWithdraw(
                    user,
                    callbackQuery.message.chat.id
                );

                return true;
            }

            if (data === "bot:referral") {
                await telegramApi(
                    "answerCallbackQuery",
                    {
                        callback_query_id:
                            callbackQuery.id
                    },
                    botToken
                );

                await sendTelegramBotReferral(
                    user,
                    callbackQuery.message.chat.id
                );

                return true;
            }

            if (
                await handleTelegramBotPlanCallback(
                    callbackQuery,
                    user,
                    botToken
                )
            ) {
                return true;
            }

            if (
                await handleTelegramBotActivateCallback(
                    callbackQuery,
                    user,
                    botToken
                )
            ) {
                return true;
            }

            return true;

        } catch (error) {
            console.error(
                "Telegram bot callback error:",
                error
            );

            await telegramApi(
                "answerCallbackQuery",
                {
                    callback_query_id:
                        callbackQuery.id,
                    text:
                        "Something went wrong. Please try again.",
                    show_alert:
                        true
                },
                botToken
            ).catch(() => {});

            return true;
        }
    }

    async function handleTelegramUserMessage(message) {
        if (!message?.from || !message?.chat) {
            return false;
        }

        /*
        Keep the admin control panel separate.
        Admin messages continue to be handled by
        handleTelegramAdminMessage().
        */
        if (
            TELEGRAM_ADMIN_USER_ID &&
            TELEGRAM_ADMIN_CHAT_ID &&
            String(message.from.id) ===
                String(TELEGRAM_ADMIN_USER_ID) &&
            String(message.chat.id) ===
                String(TELEGRAM_ADMIN_CHAT_ID)
        ) {
            return false;
        }

        const text =
            (message.text || "").trim();

        console.log(`Telegram USER message: ${message.from.id} ${message.from.username || message.from.first_name || ""} -> ${text || "[non-text]"}`);

        const telegramId = String(message.from.id);
        const chatId = telegramBotChatId(message);
        const session = getTelegramBotSession(telegramId);

        if (session?.type === "deposit" && message.photo) {
            await submitTelegramBotDepositPhoto(message, session);
            return true;
        }

        if (session && (text || message.photo)) {
            if (text === "/cancel" || text === "❌ Cancel") {
                clearTelegramBotSession(telegramId);
                await sendTelegramUserMessage(chatId, "❌ Current action cancelled.", { reply_markup: telegramBotMainMenuInline() });
                return true;
            }

            if (session.type === "deposit") {
                if (session.step === "amount") {
                    const amount = Number(text.replace(/[₦,\s]/g, ""));
                    if (!Number.isFinite(amount) || amount < 3000 || amount > 10000000) {
                        await sendTelegramUserMessage(chatId, "❌ Please send a valid amount between *₦3,000* and *₦10,000,000*.", { parse_mode: "Markdown" });
                        return true;
                    }
                    session.amount = amount;
                    session.step = "photo";
                    setTelegramBotSession(telegramId, session);
                    await sendTelegramBotCancelPrompt(chatId, `📸 *Payment screenshot*\n\nNow send the screenshot/photo of your payment here.\n\nMake sure the amount and transaction details are visible.`);
                    return true;
                }
                if (session.step === "photo") {
                    await sendTelegramUserMessage(chatId, "📸 Please send the payment screenshot as a photo.");
                    return true;
                }
            }

            if (session.type === "withdraw") {
                if (session.step === "bank_name") {
                    if (text.length < 2 || text.length > 100) {
                        await sendTelegramUserMessage(chatId, "❌ Please send a valid bank name.");
                        return true;
                    }
                    session.data.bank_name = text;
                    session.step = "account_number";
                    setTelegramBotSession(telegramId, session);
                    await sendTelegramBotCancelPrompt(chatId, "🔢 *Account number*\n\nSend your 10-digit Nigerian bank account number.");
                    return true;
                }
                if (session.step === "account_number") {
                    const accountNumber = text.replace(/\D/g, "");
                    if (!/^\d{10}$/.test(accountNumber)) {
                        await sendTelegramUserMessage(chatId, "❌ Account number must contain exactly 10 digits.");
                        return true;
                    }
                    session.data.account_number = accountNumber;
                    session.step = "account_name";
                    setTelegramBotSession(telegramId, session);
                    await sendTelegramBotCancelPrompt(chatId, "👤 *Account name*\n\nSend the full account name exactly as it appears at your bank.");
                    return true;
                }
                if (session.step === "account_name") {
                    if (text.length < 3 || text.length > 120) {
                        await sendTelegramUserMessage(chatId, "❌ Please send a valid full account name.");
                        return true;
                    }
                    session.data.account_name = text;
                    session.step = "amount";
                    setTelegramBotSession(telegramId, session);
                    await sendTelegramBotCancelPrompt(chatId, `💵 *Withdrawal amount*\n\nSend the amount you want to withdraw.\n\nMinimum: *${telegramMoney(MIN_WITHDRAWAL)}*\nAvailable: *${telegramMoney((await telegramBotUserById(telegramId))?.balance)}*`);
                    return true;
                }
                if (session.step === "amount") {
                    await submitTelegramBotWithdrawal(telegramId, chatId, session, text);
                    return true;
                }
            }
        }

        if (!text) {
            return false;
        }

        const command =
            text
                .split(/\s+/)[0]
                .split("@")[0]
                .toLowerCase();

        const startParam =
            command === "/start"
                ? (
                    text
                        .split(/\s+/)
                        .slice(1)
                        .join(" ")
                        .trim()
                )
                : "";

        try {
            const existingBeforeStart =
                await telegramBotUserById(
                    String(message.from.id)
                );

            const user =
                await getOrCreateTelegramBotUser(
                    message.from,
                    startParam
                );

            const isNewUser =
                !existingBeforeStart;

            if (
                command === "/start" ||
                command === "/menu" ||
                text === "🚀 Open Web App"
            ) {
                if (text === "🚀 Open Web App") {
                    await sendTelegramUserMessage(
                        telegramBotChatId(message),
                        "🚀 Tap the button below to open the full Netnaira Web App.",
                        {
                            reply_markup:
                                telegramBotMainMenuInline()
                        }
                    );
                } else {
                    await sendTelegramBotHome(
                        message,
                        command === "/start" &&
                            isNewUser
                    );
                }

                return true;
            }

            if (
                command === "/balance" ||
                text === "💰 Balance"
            ) {
                await sendTelegramBotBalance(
                    user,
                    telegramBotChatId(message)
                );
                return true;
            }

            if (
                command === "/plans" ||
                command === "/earn" ||
                text === "📈 Plans"
            ) {
                await sendTelegramBotPlans(
                    telegramBotChatId(message)
                );
                return true;
            }

            if (
                command === "/deposit" ||
                text === "💳 Deposit"
            ) {
                await sendTelegramBotDeposit(
                    telegramBotChatId(message)
                );
                return true;
            }

            if (
                command === "/withdraw" ||
                text === "💸 Withdraw"
            ) {
                await sendTelegramBotWithdraw(
                    user,
                    telegramBotChatId(message)
                );
                return true;
            }

            if (
                command === "/referral" ||
                text === "👥 Referral"
            ) {
                await sendTelegramBotReferral(
                    user,
                    telegramBotChatId(message)
                );
                return true;
            }

            if (
                command === "/support" ||
                text === "🆘 Support"
            ) {
                await sendTelegramUserMessage(
                    telegramBotChatId(message),
                    "🆘 Need help? Contact Netnaira support.",
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text:
                                            "💬 Contact Support",
                                        url:
                                            TELEGRAM_SUPPORT_URL
                                    }
                                ],
                                [
                                    {
                                        text:
                                            "🚀 Open Web App",
                                        web_app: {
                                            url:
                                                `${APP_BASE_URL}/auth.html`
                                        }
                                    }
                                ]
                            ]
                        }
                    }
                );
                return true;
            }

            if (
                command === "/help"
            ) {
                await sendTelegramUserMessage(
                    telegramBotChatId(message),
                    `ℹ️ *Netnaira Bot*\n\n` +
                    `/start — Open the main menu\n` +
                    `/balance — Check your balance\n` +
                    `/plans — View earning plans\n` +
                    `/earn — View earning plans\n` +
                    `/deposit — Deposit instructions\n` +
                    `/withdraw — Withdrawal information\n` +
                    `/referral — Referral details\n` +
                    `/webapp — Open the full Web App\n` +
                    `/support — Contact support`,
                    {
                        parse_mode:
                            "Markdown",
                        reply_markup:
                            telegramBotMainMenuInline()
                    }
                );
                return true;
            }

            if (
                command === "/webapp"
            ) {
                await sendTelegramUserMessage(
                    telegramBotChatId(message),
                    "🚀 Open the full Netnaira Web App:",
                    {
                        reply_markup:
                            telegramBotMainMenuInline()
                    }
                );
                return true;
            }

            /*
            Unknown normal user text:
            keep the bot useful instead of silently
            ignoring the message.
            */
            await sendTelegramUserMessage(
                telegramBotChatId(message),
                "Choose an option from the menu below, or open the full Web App.",
                {
                    reply_markup:
                        TELEGRAM_BOT_MENU
                }
            );

            return true;

        } catch (error) {
            console.error(
                "Telegram user message error:",
                error
            );

            await sendTelegramUserMessage(
                telegramBotChatId(message),
                "⚠️ I couldn't process that right now. Please try again in a moment."
            ).catch(() => {});

            return true;
        }
    }

    async function setupTelegramBotCommands() {
        if (!TELEGRAM_USER_BOT_TOKEN) {
            return;
        }

        try {
            await telegramApi(
                "setMyCommands",
                {
                    commands: [
                        {
                            command: "start",
                            description:
                                "Open Netnaira main menu"
                        },
                        {
                            command: "balance",
                            description:
                                "Check your balance"
                        },
                        {
                            command: "plans",
                            description:
                                "View earning plans"
                        },
                        {
                            command: "earn",
                            description:
                                "View earning plans"
                        },
                        {
                            command: "deposit",
                            description:
                                "Get deposit instructions"
                        },
                        {
                            command: "withdraw",
                            description:
                                "View withdrawal options"
                        },
                        {
                            command: "referral",
                            description:
                                "View your referral details"
                        },
                        {
                            command: "webapp",
                            description:
                                "Open the full Web App"
                        },
                        {
                            command: "support",
                            description:
                                "Contact support"
                        },
                        {
                            command: "help",
                            description:
                                "Show bot commands"
                        }
                    ]
                },
                TELEGRAM_USER_BOT_TOKEN
            );

            /*
            Set the persistent menu button to open
            the same Web App. Users can still use
            normal bot commands/buttons.
            */
            await telegramApi(
                "setChatMenuButton",
                {
                    menu_button: {
                        type:
                            "web_app",
                        text:
                            "Open Web App",
                        web_app: {
                            url:
                                `${APP_BASE_URL}/auth.html`
                        }
                    }
                },
                TELEGRAM_USER_BOT_TOKEN
            );

            console.log(
                "Telegram user bot commands/menu configured."
            );

        } catch (error) {
            console.error(
                "Telegram bot menu setup error:",
                error.message
            );
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
        callbackQuery,
        botToken = TELEGRAM_ADMIN_BOT_TOKEN
    ) {

        if (!callbackQuery) {
            return;
        }

        const callbackData =
            callbackQuery.data ||
            "";

        /*
        Normal user-bot callbacks are deliberately
        separated from the admin approval callbacks.
        */
        if (
            callbackData.startsWith("bot:")
        ) {
            await handleTelegramBotCallback(
                callbackQuery,
                botToken
            );
            return;
        }

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

                try {
                    const { data: depositUser } = await supabase
                        .from("users")
                        .select("telegram_id")
                        .eq("id", data.user_id)
                        .maybeSingle();

                    if (depositUser?.telegram_id) {
                        await sendTelegramUserMessage(
                            depositUser.telegram_id,
                            `✅ *Deposit approved!*\n\n₦${approvedAmount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been added to your Netnaira balance.\n\nNew balance: *${telegramMoney(newBalance)}*`,
                            { parse_mode: "Markdown", reply_markup: telegramBotMainMenuInline() }
                        );
                    }
                } catch (notifyError) {
                    console.error("Deposit approval user notification error:", notifyError);
                }


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

            // This webhook belongs to the USER/Web App bot.
            return handleTelegramWebhookUpdate(
                req,
                res,
                TELEGRAM_USER_BOT_TOKEN
            );
        }
    );

    // Separate webhook for the ADMIN bot so its Accept/Reject buttons continue to work.
    app.post(
        "/api/telegram/admin-webhook",
        async (req, res) => {
            return handleTelegramWebhookUpdate(
                req,
                res,
                TELEGRAM_ADMIN_BOT_TOKEN,
                true
            );
        }
    );

    async function handleTelegramWebhookUpdate(
        req,
        res,
        botToken,
        adminOnly = false
    ) {

            /*
            Validate the Telegram secret when one is configured.
            The secret is optional, so a missing secret must not
            disable the user-facing bot.
            */
            if (
                TELEGRAM_WEBHOOK_SECRET &&
                req.get(
                    "X-Telegram-Bot-Api-Secret-Token"
                ) !==
                    TELEGRAM_WEBHOOK_SECRET
            ) {

                console.warn(
                    "Rejected Telegram webhook request: invalid secret token."
                );

                return res.sendStatus(401);

            }

            try {

                if (
                    req.body &&
                    req.body.callback_query
                ) {

                    await handleTelegramCallback(
                        req.body.callback_query,
                        botToken
                    );

                }

                if (
                    req.body &&
                    req.body.message
                ) {

                    if (adminOnly) {
                        await handleTelegramAdminMessage(
                            req.body.message
                        );
                    } else {
                        const handledByUserBot =
                            await handleTelegramUserMessage(
                                req.body.message
                            );

                        if (!handledByUserBot) {
                            await handleTelegramAdminMessage(
                                req.body.message
                            );
                        }
                    }

                }

            } catch (error) {

                console.error(
                    "Telegram webhook error:",
                    error
                );

            }

            return res.sendStatus(200);
    }


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

        if (!TELEGRAM_USER_BOT_TOKEN && !TELEGRAM_ADMIN_BOT_TOKEN) {
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

                        const handledByUserBot =
                            await handleTelegramUserMessage(
                                update.message
                            );

                        if (!handledByUserBot) {
                            await handleTelegramAdminMessage(
                                update.message
                            );
                        }

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

        if (!TELEGRAM_ADMIN_BOT_TOKEN && !TELEGRAM_USER_BOT_TOKEN) {
            return;
        }

        await setupTelegramBotCommands();

        const userWebhookUrl =
            TELEGRAM_WEBHOOK_URL;

        const adminWebhookUrl =
            process.env.TELEGRAM_ADMIN_WEBHOOK_URL ||
            `${APP_BASE_URL}/api/telegram/admin-webhook`;

        async function configureWebhook(label, token, url) {
            if (!token || !url) return;

            const webhookBody = {
                url,
                allowed_updates: ["callback_query", "message"],
                drop_pending_updates: false
            };

            if (TELEGRAM_WEBHOOK_SECRET) {
                webhookBody.secret_token = TELEGRAM_WEBHOOK_SECRET;
            }

            try {
                await telegramApi("setWebhook", webhookBody, token);

                const info = await telegramApi(
                    "getWebhookInfo",
                    {},
                    token
                );

                console.log(`Telegram ${label} updates: WEBHOOK`);
                console.log(`${label} webhook URL: ${url}`);
                console.log(
                    `Telegram ${label} webhook status: ${info?.url || "not set"}`
                );

                if (info?.last_error_message) {
                    console.warn(
                        `Telegram ${label} webhook last error: ${info.last_error_message}`
                    );
                }

                return true;
            } catch (error) {
                console.error(
                    `Telegram ${label} webhook setup error:`,
                    error.message
                );
                return false;
            }
        }

        // The Web App bot receives normal user messages.
        const userConfigured = await configureWebhook(
            "USER/Web App bot",
            TELEGRAM_USER_BOT_TOKEN,
            userWebhookUrl
        );

        // The admin bot receives approval callbacks/messages separately.
        await configureWebhook(
            "ADMIN bot",
            TELEGRAM_ADMIN_BOT_TOKEN,
            adminWebhookUrl
        );

        if (!userConfigured && TELEGRAM_USER_BOT_TOKEN) {
            console.warn(
                "USER/Web App webhook could not be configured. Check TELEGRAM_WEBAPP_BOT_TOKEN and TELEGRAM_WEBHOOK_URL."
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

                    /*
                    Same clean-up the bot's /start handler
                    does: trim, drop a leading @, lowercase.
                    */

                    const cleanRef =
                        typeof ref === "string"
                            ? ref
                                .trim()
                                .replace(/^@/, "")
                                .toLowerCase()
                            : "";

                    if (cleanRef) {

                        const { data: referrerRow, error: referrerLookupError } =
                            await supabase
                                .from("users")
                                .select("id, username")
                                .eq(
                                    "username",
                                    cleanRef
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

                            if (referralResult?.success === true) {

                                notifyReferrerOfNewReferral(
                                    referrer.id,
                                    tgUser.first_name ||
                                        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") ||
                                        candidateUsername
                                );

                            }

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

                            notifyReferrerOfNewReferral(
                                referrer.id,
                                cleanFullName || cleanUsername
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
                        telegramWebAppReferralLink(user.username),

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
                        "id, full_name, username, telegram_id"
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

                    } else {

                        /*
                        The deposit reached the admin for review,
                        so tell the user it's pending approval.
                        Not awaited and fully self-contained, so
                        it can never flip the deposit to
                        telegram_failed.
                        */

                        notifyUserDepositPending(
                            user.telegram_id,
                            deposit.amount
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

            if (TELEGRAM_ADMIN_BOT_TOKEN) {
                try {
                    const botInfo =
                        await telegramApi(
                            "getMe",
                            {},
                            TELEGRAM_ADMIN_BOT_TOKEN
                        );

                    console.log(
                        `Telegram ADMIN bot connected: @${botInfo?.username || "unknown"} (id ${botInfo?.id || "unknown"})`
                    );
                } catch (telegramStartupError) {
                    console.error(
                        "Telegram ADMIN bot connection check failed:",
                        telegramStartupError.message
                    );
                }
            }

            if (TELEGRAM_USER_BOT_TOKEN) {
                try {
                    const botInfo =
                        await telegramApi(
                            "getMe",
                            {},
                            TELEGRAM_USER_BOT_TOKEN
                        );

                    console.log(
                        `Telegram USER/Web App bot connected: @${botInfo?.username || "unknown"} (id ${botInfo?.id || "unknown"})`
                    );
                } catch (telegramStartupError) {
                    console.error(
                        "Telegram USER/Web App bot connection check failed:",
                        telegramStartupError.message
                    );
                }
            }


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

            startWithdrawalHighlights();

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




