import * as line from "@line/bot-sdk";
import { WebhookRequestBody, FollowEvent, Message, MessageEvent, ClientConfig, WebhookEvent } from "@line/bot-sdk";
import mysql from "mysql2/promise";
import { ConnectionOptions, ResultSetHeader } from "mysql2";
import { createClient, RedisClientType } from "redis";

import { UserStatusData, BirthdayInfomation, userCache } from "./type";

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
			// NOTE: 暫定対応
			switch (Number(userStatus)) {
				case CHRONOS_USER_STATUS.addName:
					await registerBirthdayName(event.source.userId, text);
					await reply("誕生日を登録する人の誕生日を入力してください", replyToken);
					break;
				case CHRONOS_USER_STATUS.addDate:
					await registerBirthdayDate(event.source.userId, text);
					await reply("新しい誕生日を登録しました", replyToken);
					break;
				case CHRONOS_USER_STATUS.delete:
					await registerBirthdayName(event.source.userId, text);
					await reply("削除しました", replyToken);
					break;
				default:
					console.error("ERROR: invalid user Status");
					throw new Error("invalid User Status");
			}
		} else {
			switch (text) {
				case CHRONOS_EVENT_TYPE.adding:
					await reply("誕生日を登録する人の名前を入力してください", replyToken);
					break;
				case CHRONOS_EVENT_TYPE.listing:
					const birthdays = await getUsersBirthdays(userId);
					await reply(birthdays, replyToken);
					break;
				case CHRONOS_EVENT_TYPE.delete:
					await reply("誕生日を削除する人の名前を入力してください", replyToken);
					break;
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

	return isSuccess;
};

// DB connetion
const registerNewUser = async (userId: string) => {
	const userInsertQuery = `
		INSERT INTO user_accounts (id, created_at, updated_at) VALUES (?, Now(), Now());
	`;
	const connect = await mysql.createConnection(dbConfig);
	return connect.execute<ResultSetHeader>(userInsertQuery, [userId]);
};

const getUsersBirthdays = async (userId: string) => {
	const userBirthdaysQuery = `
		SELECT name, year, month, date FROM birthdays WHERE user_account_id = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [birthdayInfomation] = await connect.query<BirthdayInfomation[]>(userBirthdaysQuery, [userId]);
	return buildBirthday(birthdayInfomation);
};

const registerBirthdayName = async (userId: string | undefined, name: string | null) => {
	const birthdayNameQuery = `
		INSERT INTO birthdays (user_account_id, name, created_at, updated_at) VALUES (?, ?, Now(), Now());
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [status] = await connect.query<UserStatusData[]>(birthdayNameQuery, [userId, name]);
	return status[0].status;
};

const registerBirthdayDate = async (userId: string | undefined, text: string | null) => {
	if (!text) {
		throw new Error("dateが未入力です");
	}
	const regEx = /^((19|20)\d{2}\/)?(0[1-9]|[1-9]|1[0-2]|)\/(0[1-9]|[1-9]|[1-2]\d{1}|3[0-1])$/g;
	if (!text.match(regEx)) {
		throw new Error("入力形式が違います");
	}
	const splittedDate = text.split("/");
	const [year, month, date] =
		splittedDate.length === 3 ? [splittedDate[0], splittedDate[1], splittedDate[2]] : [null, splittedDate[0], splittedDate[1]];
	const findBirthdayQuery = `
		SELECT id FROM birthdays WHERE user_account_id = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
		`;
	const connect = await mysql.createConnection(dbConfig);
	const [id] = await connect.query<UserStatusData[]>(findBirthdayQuery, [userId]);

	const inputBirthdayQuery = `
		UPDATE birthdays SET year = ?, month = ?, date = ? WHERE id = ?;
	`;
	const [result] = await connect.execute<UserStatusData[]>(inputBirthdayQuery, [year, month, date, userId]);
};

const buildBirthday = (birthdays: BirthdayInfomation[]) => {
	const list = birthdays.reduce((accu, curr) => {
		if (!curr.year) {
			return (accu += `${curr.name}: ${curr.month}月${curr.date}日\n`);
		}
		const year = `${curr.year}年`;
		const currentTime = new Date();
		let age: number = currentTime.getFullYear() - curr.year;
		if (curr.month > currentTime.getMonth()) {
			age--;
		} else if (curr.month == currentTime.getMonth()) {
			if (curr.date > currentTime.getDate()) {
				age--;
			}
		}
		return (accu += `${curr.name}: ${year}${curr.month}月${curr.date}日 (${age}歳)\n`);
	}, "誕生日の一覧\n");
	return list.replace(/\n$/, "");
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
