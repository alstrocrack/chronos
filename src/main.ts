import * as line from "@line/bot-sdk";
import { WebhookRequestBody, FollowEvent, Message, MessageEvent, ClientConfig, WebhookEvent } from "@line/bot-sdk";
import mysql from "mysql2/promise";
import { ConnectionOptions, ResultSetHeader } from "mysql2";
import { createClient, RedisClientType } from "redis";

import { BirthdayInfomation } from "./type";

// Settings
const lineConfig: ClientConfig = {
	channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
	channelSecret: process.env.CHANNEL_SECRET!,
};

const dbConfig: ConnectionOptions = {
	host: process.env.DB_HOST!,
	user: process.env.DB_USER!,
	password: process.env.DB_PASSWORD!,
	database: process.env.DB_NAME!,
	port: Number(process.env.DB_PORT!),
};

const redisConfig = {
	socket: {
		host: process.env.REDIS_HOST,
		port: Number(process.env.REDIS_PORT),
	},
};

// constants
const CHRONOS_EVENT_TYPE = {
	adding: "誕生日の追加",
	listing: "誕生日の一覧",
	delete: "誕生日の削除",
	cancel: "キャンセル",
};

const CHRONOS_USER_STATUS = {
	addName: 1,
	addDate: 2,
	delete: 3,
};

// handler
export const handler = async (event: WebhookRequestBody, callback: any) => {
	const events: Array<WebhookEvent> = event.events;

	const eventsResult: boolean[] = await Promise.all(
		events.map(async (event) => {
			return await handleEachEvent(event);
		}),
	);

	if (eventsResult.includes(false)) {
		throw new Error("invalid request");
	}
	console.log("success");
};

const handleEachEvent = async (event: WebhookEvent) => {
	let eventResult: boolean = true;

	if (event.type == "follow") {
		eventResult = await followEvent(event);
	} else if (event.type == "message") {
		eventResult = await replyEvent(event);
	} else {
		console.error("ERROR: eventType not specified");
		eventResult = false;
	}

	return eventResult;
};

const followEvent = async (event: FollowEvent) => {
	let isSuccess: boolean = true;
	const userId = event.source.userId;
	if (!userId) {
		console.error("ERROR: userId not found");
		return false;
	}

	await registerNewUser(userId).catch((res) => {
		console.error(`ERROR: ${res}`);
		isSuccess = false;
	});
	await reply("Birthday Reminderを登録ありがとうございます！", event.replyToken).catch((res) => {
		console.error(`ERROR: ${res}`);
		isSuccess = false;
	});
	return isSuccess;
};

const replyEvent = async (event: MessageEvent) => {
	let isSuccess: boolean = true;
	const userId = event.source.userId;
	if (!userId) {
		console.error("ERROR: userId not found");
		return false;
	}

	const replyToken = event.replyToken;
	if (!replyToken) {
		console.error("ERROR: replyToken not found");
		return false;
	}

	if (event.message.type != "text") {
		// Don't process anymore
		return true;
	}
	const text = event.message.text;

	const redisClient: RedisClientType = createClient(redisConfig);
	await redisClient.connect();

	const userStatus = await redisClient.hGet(userId, "status");

	try {
		// NOTE: statusがあれば登録か削除の最中
		if (userStatus) {
			switch (Number(userStatus)) {
				case CHRONOS_USER_STATUS.addName:
					const isInvlidName = await hasMultipleName(userId, text);
					if (isInvlidName) {
						throw new Error("同じ名前が登録されています");
					}
					await redisClient.hSet(userId, "status", CHRONOS_USER_STATUS.addDate);
					await redisClient.hSet(userId, "name", text);
					await reply("誕生日を登録する人の誕生日を入力してください", replyToken);
					break;
				case CHRONOS_USER_STATUS.addDate:
					const name = await redisClient.hGet(userId, "name");
					await redisClient.del(userId);
					await registerBirthdayDate(userId, name, text);
					await reply("新しい誕生日を登録しました", replyToken);
					break;
				case CHRONOS_USER_STATUS.delete:
					await deleteBirthday(userId, text);
					await reply("削除しました", replyToken);
					await redisClient.del(userId);
					break;
				default:
					console.error("ERROR: invalid user Status");
					throw new Error("invalid User Status");
			}
		} else {
			switch (text) {
				case CHRONOS_EVENT_TYPE.adding:
					redisClient.hSet(userId, "status", CHRONOS_USER_STATUS.addName);
					await reply("誕生日を登録する人の名前を入力してください", replyToken);
					break;
				case CHRONOS_EVENT_TYPE.listing:
					const birthdays = await getUsersBirthdays(userId);
					await reply(birthdays, replyToken);
					break;
				case CHRONOS_EVENT_TYPE.delete:
					redisClient.hSet(userId, "status", CHRONOS_USER_STATUS.delete);
					await reply("誕生日を削除する人の名前を入力してください", replyToken);
					break;
				case CHRONOS_EVENT_TYPE.cancel:
					await redisClient.del(userId);
					await reply("キャンセルしました", replyToken);
				default:
					console.error("ERROR: invalid chronosEventType");
					throw new Error("invalid Chronos Event Type");
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			isSuccess = false;
			console.error(`ERROR: ${error}`);
			console.error(`BACKTRACE: ${error.stack}`);
		}
	}

	await redisClient.disconnect();

	return isSuccess;
};

// DB connetion
const registerNewUser = async (userId: string) => {
	const userInsertQuery = `
		INSERT INTO user_accounts (id, created_at, updated_at) VALUES (?, Now(), Now());
	`;
	const connect = await mysql.createConnection(dbConfig);
	await connect.execute<ResultSetHeader>(userInsertQuery, [userId]);
	await connect.end();
	return;
};

const getUsersBirthdays = async (userId: string) => {
	const userBirthdaysQuery = `
		SELECT name, year, month, date FROM birthdays WHERE user_account_id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [birthdayInfomation] = await connect.query<BirthdayInfomation[]>(userBirthdaysQuery, [userId]);
	await connect.end();
	return buildBirthday(birthdayInfomation);
};

const hasMultipleName = async (userId: string, text: string) => {
	const researchMultipleNameQuery = `
		SELECT * FROM birthdays WHERE user_account_id = ? AND name = ? LIMIT 1;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [multipleName] = await connect.query<any[]>(researchMultipleNameQuery, [userId, text]);
	await connect.end();
	return !!multipleName.length;
};

const registerBirthdayDate = async (userId: string | undefined, name: string | undefined, text: string | undefined) => {
	if (!text) {
		throw new Error("名前が未入力です");
	}
	if (!userId) {
		throw new Error("userIdがありません");
	}
	if (!name) {
		throw new Error("Nameがありません");
	}
	const regEx = /^(19\d{2}|20\d{2})?\/?(0[1-9]|1\d|2\d|[1-9])\/(0[1-9]|1\d|2\d|3[01]|[1-9])$/;
	const result = text.match(regEx);
	if (!result) {
		throw new Error("入力形式が違います");
	}
	const [year, month, date] = [result[1] ? result[1] : null, result[2], result[3]];
	const connect = await mysql.createConnection(dbConfig);
	const inputBirthdayQuery = `
		INSERT INTO chronos.birthdays (user_account_id, name, year, month, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, Now(), Now());
	`;
	await connect.execute(inputBirthdayQuery, [userId, name, year, month, date]);
	await connect.end();
};

const buildBirthday = (birthdays: BirthdayInfomation[]) => {
	const list = birthdays.reduce((accu, curr) => {
		if (!curr.year) {
			return (accu += `${curr.name}: ${curr.month}月${curr.date}日\n`);
		}
		const year = `${curr.year}年`;
		const currentTime = new Date();
		let age: number = currentTime.getFullYear() - curr.year;
		if (curr.month > currentTime.getMonth() + 1) {
			age--;
		} else if (curr.month == currentTime.getMonth() + 1) {
			if (curr.date > currentTime.getDate()) {
				age--;
			}
		}
		return (accu += `${curr.name}: ${year}${curr.month}月${curr.date}日 (${age}歳)\n`);
	}, "誕生日の一覧\n");
	return list.replace(/\n$/, "");
};

const deleteBirthday = async (userId: string, text: string) => {
	const deleteBirthdayQuery = `
		DELETE FROM chronos.birthdays WHERE user_account_id = ? AND name = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [result] = await connect.execute<ResultSetHeader>(deleteBirthdayQuery, [userId, text]);
	await connect.end();
	return !!result.affectedRows;
};

// general
const reply = async (text: string, replyToken: string) => {
	const client = new line.Client(lineConfig);
	const message: Message = {
		type: "text",
		text: text,
	};
	return await client.replyMessage(replyToken, message);
};
