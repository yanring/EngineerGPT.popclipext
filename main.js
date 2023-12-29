"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.options = exports.actions = void 0;
const axios_1 = require("axios");
class ChatGPTAction {
    processResponse(popclip, resp) {
        return resp.data.choices[0].message.content.trim();
    }
    onRequestError(popclip, e) { }
    doCleanup() { }
}
const InactiveChatHistoryResetIntervalMs = 20 * 1000 * 60; // 20 minutes.
// const MaxChatHistoryLength = 50
class ChatHistory {
    constructor(appIdentifier) {
        this.appIdentifier = appIdentifier;
        this._lastActiveAt = new Date();
        this._messages = [];
    }
    isActive() {
        return new Date().getTime() - this._lastActiveAt.getTime() < InactiveChatHistoryResetIntervalMs;
    }
    clear() {
        this._messages.length = 0;
    }
    push(message) {
        this._messages.push(message);
        this._lastActiveAt = new Date();
    }
    pop() {
        return this._messages.pop();
    }
    get lastActiveAt() {
        return this._lastActiveAt;
    }
    get messages() {
        return this._messages;
    }
}
class ChatAction extends ChatGPTAction {
    constructor() {
        super();
        this.chatHistories = new Map();
    }
    getChatHistory(appIdentifier) {
        let chat = this.chatHistories.get(appIdentifier);
        if (!chat) {
            chat = new ChatHistory(appIdentifier);
            this.chatHistories.set(appIdentifier, chat);
        }
        return chat;
    }
    doCleanup() {
        for (const [appid, chat] of this.chatHistories) {
            if (!chat.isActive()) {
                this.chatHistories.delete(appid);
            }
        }
    }
    beforeRequest(popclip, input, options, action) {
        if (popclip.modifiers.shift) {
            this.chatHistories.delete(popclip.context.appIdentifier);
            const text = `${popclip.context.appName}(${popclip.context.appIdentifier})'s chat history has been cleared`;
            return { allow: false, reason: text };
        }
        return { allow: true };
    }
    makeRequestData(popclip, input, options, action) {
        if (action !== "chat") {
            return null;
        }
        const chat = this.getChatHistory(popclip.context.appIdentifier);
        chat.push({ role: "user", content: input.text });
        return {
            model: options.model,
            messages: chat.messages,
            temperature: Number(options.temperature),
        };
    }
    onRequestError(popclip, e) {
        const chat = this.getChatHistory(popclip.context.appIdentifier);
        chat.pop(); // Pop out the user message.
    }
    processResponse(popclip, resp) {
        const chat = this.getChatHistory(popclip.context.appIdentifier);
        chat.push(resp.data.choices[0].message);
        return resp.data.choices[0].message.content.trim();
    }
}
class OneTimeAction extends ChatGPTAction {
    getPrompt(action, language) {
        switch (action) {
            case "custom":
                return `fill the docstring in google style: \n`;
            case "writing":
                return `Act as a English proofreader. Feel free to rephrase sentences or make changes to make it straightforward, consise, technical tone suitable for an official English document. Please maintain the original formatting if the original text is in Markdown. Please provide the revised text directly and ensure clarity and conciseness. The original text is as follows:`;
            case "dialogue":
                return `You are an expert working in Google. Please rephrase the following text into a clear and concise English expression that your colleagues can understand in daily conversation, while making it sound nature and concise. Please provide the revised text directly. The original text is as follows:`;
            case "translate":
                return `Act as a English proofreader and review the following text. Feel free to rephrase sentences or make changes to enhance clarity but maintain the overall tone and style of the original. Please provide the revised text directly. The original text is as follows:`;
            case "spell":
                return `Act as an English proofreader and review the following text. Please correct the spelling and grammar of the text below and provide the corrected version. Please provide the revised text only. The original text is as follows:`;
        }
    }
    beforeRequest(popclip, input, options, action) {
        return { allow: options[`${action}Enabled`] };
    }
    makeRequestData(popclip, input, options, action) {
        if (action === "chat") {
            return null;
        }
        const language = popclip.modifiers.shift ? options[`${action}SecondaryLanguage`] : options[`${action}PrimaryLanguage`];
        const prompt = this.getPrompt(action, language);
        return {
            model: options.model,
            messages: [
                // { role: "system", content: "You are a professional multilingual assistant who will help me writing, dialogue, or translate texts. Please strictly follow user instructions." },
                {
                    role: "user", content: `${prompt} ${input.text}`,
                },
            ],
            temperature: Number(options.temperature),
        };
    }
}
function makeClientOptions(options) {
    const timeoutMs = 35000;
    if (options.apiType === "openai") {
        return {
            "baseURL": options.apiBase,
            headers: { Authorization: `Bearer ${options.apiKey}` },
            timeout: timeoutMs,
            proxy: {
                host: '127.0.0.1',
                port: 7890,
                protocol: 'http'
            }
        };
    }
    else if (options.apiType === "azure") {
        // Ref: https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#chat-completions
        return {
            "baseURL": options.apiBase,
            headers: { "api-key": `${options.apiKey}` },
            params: {
                "api-version": options.apiVersion,
            },
            timeout: timeoutMs,
        };
    }
    throw new Error(`unsupported api type: ${options.apiType}`);
}
function isTerminalApplication(appName) {
    return appName === "iTerm2" || appName === "Terminal" || appName === "Notion";
}
const chatGPTActions = new Map();
function doCleanup() {
    for (const [_, actionImpl] of chatGPTActions) {
        actionImpl.doCleanup();
    }
}
async function doAction(popclip, input, options, action) {
    doCleanup();
    const actionImpl = chatGPTActions.get(action);
    const guard = actionImpl.beforeRequest(popclip, input, options, action);
    if (!guard.allow) {
        if (guard.reason) {
            popclip.showText(guard.reason);
            popclip.showSuccess();
        }
        return;
    }
    const requestData = actionImpl.makeRequestData(popclip, input, options, action);
    const openai = axios_1.default.create(makeClientOptions(options));
    try {
        const resp = await openai.post("chat/completions", requestData);
        const result = actionImpl.processResponse(popclip, resp);
        let toBePasted = `${result}`;
        // popclip.pasteText(toBePasted, { restore: true })
        popclip.copyText(toBePasted);
        popclip.showText(toBePasted, { preview: false });
        // popclip.showSuccess()
        // if (popclip.context.canPaste) {
        //     let toBePasted = `\n\n${result}\n`
        //     if (!isTerminalApplication(popclip.context.appName) && popclip.context.canCopy) {
        //         // Prevent the original selected text from being replaced.
        //         toBePasted = `${input.text}\n\n${result}\n`
        //     }
        //     popclip.pasteText(toBePasted, { restore: true })
        //     popclip.copyText(toBePasted)
        //     popclip.showText(toBePasted, { preview: true })
        //     popclip.showSuccess()
        // } else {
        //     popclip.copyText(result)
        //     popclip.showText(result, { preview: true })
        // }
    }
    catch (e) {
        actionImpl.onRequestError(popclip, e);
        // popclip.showFailure()
        popclip.showText(String(e));
    }
}
chatGPTActions.set("chat", new ChatAction());
chatGPTActions.set("custom", new OneTimeAction());
chatGPTActions.set("writing", new OneTimeAction());
chatGPTActions.set("dialogue", new OneTimeAction());
chatGPTActions.set("translate", new OneTimeAction());
chatGPTActions.set("spell", new OneTimeAction());
exports.actions = [
    {
        title: "ChatGPTx: do what you want (click while holding shift(⇧) to force clear the history for this app)",
        // icon: "symbol:arrow.up.message.fill", // icon: "iconify:uil:edit",
        requirements: ["text"],
        code: async (input, options, context) => doAction(popclip, input, options, "chat"),
    },
    {
        title: "custom",
        icon: "symbol:c.square.fill",
        requirements: ["text", "option-writingEnabled=1"],
        code: async (input, options, context) => doAction(popclip, input, options, "custom"),
    },
    {
        title: "ChatGPTx: writing",
        icon: "symbol:w.square.fill",
        requirements: ["text", "option-writingEnabled=1"],
        code: async (input, options, context) => doAction(popclip, input, options, "writing"),
    },
    {
        title: "ChatGPTx: dialogue",
        icon: "symbol:d.square.fill",
        requirements: ["text", "option-dialogueEnabled=1"],
        code: async (input, options, context) => doAction(popclip, input, options, "dialogue"),
    },
    {
        title: "ChatGPTx: translate text",
        icon: "symbol:t.square.fill",
        requirements: ["text", "option-translateEnabled=1"],
        code: async (input, options, context) => doAction(popclip, input, options, "translate"),
    },
    {
        title: "ChatGPTx: spell text ",
        icon: "symbol:s.square.fill",
        requirements: ["text", "option-spellEnabled=1"],
        code: async (input, options, context) => doAction(popclip, input, options, "spell"),
    },
];
// Dynamic options:
//
// Prompt to list languages:
//   list top 100 languages that you can understand and generate texts in,
//   remove all dialects, such as Chinese dialects(but do include "Chinese Simplified" and "Chinese Traditional" ),
//   reply in JSON format using both English and their corresponding native language, e.g. [{"english": "Chinese Simplified", "native": "简体中文"}].
//
//   Please double check and count by yourself first.
//
// (Unfortunately, ChatGPT is unable to list 100 languages and I am exhausted from trying to make it accurate..)
const languages = require("./top-languages-from-chatgpt.json");
const optionLanguagesValues = new Array();
const optionLanguagesValueLabels = new Array();
languages.sort((a, b) => {
    if (a.english < b.english) {
        return -1;
    }
    else if (a.english > b.english) {
        return 1;
    }
    return 0;
}).forEach((value) => {
    optionLanguagesValues.push(value.english);
    optionLanguagesValueLabels.push(value.native);
});
const chatGPTActionsOptions = [
    {
        "identifier": "apiType",
        "label": "API Type",
        "type": "multiple",
        "default value": "openai",
        "values": [
            "openai",
            "azure"
        ]
    },
    {
        "identifier": "apiBase",
        "label": "API Base URL",
        "description": "For Azure: https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}",
        "type": "string",
        "default value": "https://oa.api2d.net/v1"
    },
    {
        "identifier": "apiKey",
        "label": "API Key",
        "type": "string",
        "default value": ""
    },
    {
        "identifier": "model",
        "label": "Model",
        "type": "string",
        "default value": "gpt-3.5-turbo"
    },
    {
        "identifier": "apiVersion",
        "label": "API Version (Azure only)",
        "type": "string",
        "default value": "2023-07-01-preview"
    },
    {
        "identifier": "temperature",
        "label": "Sampling Temperature",
        "type": "string",
        "description": ">=0, <=2. Higher values will result in a more random output, and vice versa.",
        "default value": "1"
    },
    {
        "identifier": "opinionedActions",
        "label": "❤ OPINIONED ACTIONS",
        "type": "heading",
        "description": "Click while holding shift(⇧) to use the secondary language.",
    }
];
new Array({ name: "custom", primary: "English", secondary: "Chinese Simplified" }, { name: "writing", primary: "English", secondary: "Chinese Simplified" }, { name: "dialogue", primary: "English", secondary: "Chinese Simplified" }, { name: "translate", primary: "Chinese Simplified", secondary: "English" }, { name: "spell", primary: "Chinese Simplified", secondary: "English" }).forEach((value) => {
    const capitalizedName = value.name.charAt(0).toUpperCase() + value.name.slice(1);
    chatGPTActionsOptions.push({
        "identifier": value.name,
        "label": `${capitalizedName} Texts`,
        "type": "heading"
    }, {
        "identifier": `${value.name}Enabled`,
        "label": "Enable",
        "type": "boolean",
        "inset": true
    }, {
        "identifier": `${value.name}PrimaryLanguage`,
        "label": "Primary",
        "type": "multiple",
        "default value": `${value.primary}`,
        "values": optionLanguagesValues,
        "value labels": optionLanguagesValueLabels,
        "inset": true
    }, {
        "identifier": `${value.name}SecondaryLanguage`,
        "label": "Secondary",
        "type": "multiple",
        "default value": `${value.secondary}`,
        "values": optionLanguagesValues,
        "value labels": optionLanguagesValueLabels,
        "inset": true
    });
});
exports.options = chatGPTActionsOptions;
