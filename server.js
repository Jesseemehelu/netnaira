require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
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
        daily: 200,
        total: 6000,
        durationDays: 30
    },

    Basic: {
        amount: 5000,
        daily: 350,
        total: 10500,
        durationDays: 30
    },

    Growth: {
        amount: 10000,
        daily: 750,
        total: 22500,
        durationDays: 30
    },

    Pro: {
        amount: 25000,
        daily: 2000,
        total: 60000,
        durationDays: 30
    },

    Elite: {
        amount: 50000,
        daily: 4500,
        total: 135000,
        durationDays: 30
    },

    Premium: {
        amount: 100000,
        daily: 10000,
        total: 300000,
        durationDays: 30
    },

    VIP: {
        amount: 250000,
        daily: 27500,
        total: 825000,
        durationDays: 30
    },

    Ultimate: {
        amount: 500000,
        daily: 60000,
        total: 1800000,
        durationDays: 30
    }

};


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
    body
) {

    if (!TELEGRAM_BOT_TOKEN) {

        throw new Error(
            "TELEGRAM_BOT_TOKEN is missing."
        );

    }

    const url =
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

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
                    "callback_query"
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
                        "callback_query"
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
SIGN UP
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
                password
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
                        0,

                    total_earned:
                        0
                })
                .select(
                    "id, full_name, username, email"
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


            return res.status(201).json({
                success:
                    true,

                message:
                    "Account created successfully."
            });


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
                    "id, full_name, username, balance, total_earned, created_at"
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

            if (activePlanRow) {

                activePlan =
                    activePlanRow.plan_name;

                dailyEarning =
                    Number(
                        activePlanRow.daily_income || 0
                    );

                daysCompleted =
                    activePlanRow.days_paid || 0;

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

                    recentDeposits:
                        recentDeposits ||
                        []

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
                amount < 100 ||
                amount > 10000000
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid deposit amount."
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

🏦 Deposit Destination:
SportyBet

🆔 SportyBet User ID:
8050976449

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

app.listen(
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

