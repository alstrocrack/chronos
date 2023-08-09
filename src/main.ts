import * as line from "@line/bot-sdk";
import { FollowEvent, UnfollowEvent, Message, MessageEvent, ClientConfig, WebhookEvent } from "@line/bot-sdk";
import mysql from "mysql2/promise";
import { ConnectionOptions, ResultSetHeader } from "mysql2";
import { createClient, RedisClientType } from "redis";
import crypto from "crypto";

import { BirthdayInfomation, LambdaEvent } from "./type";

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

const REDIS_KEY = {
	status: "status",
	name: "name",
};

// handler
export const handler = async (event: LambdaEvent) => {
	const requestBody = event.body;
	const channelSecret = process.env.CHANNEL_SECRET!;
	const digest = crypto
		.createHmac("SHA256", channelSecret)
		.update(Buffer.from(JSON.stringify(requestBody)))
		.digest("base64");
	const signature: string = event.headers["x-line-signature"];
	if (digest !== signature) {
		throw new Error("The signature is different, so you may have been sent an invalid request");
	}

	const events = requestBody.events;

	await Promise.all(
		events.map(async (event) => {
			return await handleEachEvent(event);
		}),
	);

	console.info("Events Processed");
};

// 業務エラーはリプライで返して、システムエラーは例外を投げて処理を止める
const handleEachEvent = async (event: WebhookEvent) => {
	if (event.type == "follow") {
		await followEvent(event);
	} else if (event.type == "unfollow") {
		await unfollowEvent(event);
	} else if (event.type == "message") {
		await replyEvent(event);
	} else {
		throw new Error("Event type not specified");
	}
};

const followEvent = async (event: FollowEvent) => {
	const userId = event.source.userId;
	if (!userId) {
		throw new Error("Not found follow user userId");
	}

	const result = await registerOrEnableUser(userId).catch((res) => {
		console.error(`ERROR: ${res}`);
	});
	await reply(result ? "Birthday Reminderへおかえりなさい！" : "Birthday Reminderを登録ありがとうございます！", event.replyToken);
};

const unfollowEvent = async (event: UnfollowEvent) => {
	const userId = event.source.userId;
	if (!userId) {
		throw new Error("Not found follow user userId");
	}

	await disableUser(userId).catch((res) => {
		console.error(`ERROR: ${res}`);
	});
};

const replyEvent = async (event: MessageEvent) => {
	const replyToken = event.replyToken;
	const userId = event.source.userId;

	if (!replyToken) {
		throw new Error("replyToken not found");
	}
	if (!userId) {
		throw new Error("userId not found");
	}
	if (event.message.type != "text") {
		await reply("テキストで入力するか、メニューから操作を選択してください", replyToken);
		return;
	}

	const text = event.message.text;

	const redisClient: RedisClientType = createClient(redisConfig);
	await redisClient.connect();

	const userStatus = await redisClient.hGet(userId, REDIS_KEY.status);

	try {
		if (userStatus) {
			if (text === CHRONOS_EVENT_TYPE.cancel) {
				await redisClient.del(userId);
				await reply("キャンセルしました", replyToken);
				return;
			}

			switch (Number(userStatus)) {
				case CHRONOS_USER_STATUS.addName:
					const isInvlidName = await hasMultipleName(userId, text);
					if (isInvlidName) {
						throw new ReplyError("同じ名前が登録されています、別の名前を入力してください");
					}
					await redisClient.hSet(userId, REDIS_KEY.status, CHRONOS_USER_STATUS.addDate);
					await redisClient.hSet(userId, REDIS_KEY.name, text);
					await reply("誕生日を登録する人の誕生日を入力してください", replyToken);
					break;
				case CHRONOS_USER_STATUS.addDate:
					const name = await redisClient.hGet(userId, REDIS_KEY.name);
					await registerBirthdayDate(userId, name, text);
					await redisClient.del(userId);
					await reply("新しい誕生日を登録しました", replyToken);
					break;
				case CHRONOS_USER_STATUS.delete:
					const hasDeleted = await deleteBirthday(userId, text);
					await reply(hasDeleted ? `${text}さんを削除しました` : `${text}さんは登録されていないようです`, replyToken);
					await redisClient.del(userId);
					break;
				default:
					console.error("ERROR: invalid user Status");
					throw new Error("invalid User Status");
			}
		} else {
			switch (text) {
				case CHRONOS_EVENT_TYPE.adding:
					redisClient.hSet(userId, REDIS_KEY.status, CHRONOS_USER_STATUS.addName);
					await reply("誕生日を登録する人の名前を入力してください", replyToken);
					break;
				case CHRONOS_EVENT_TYPE.listing:
					const birthdays = await getUsersBirthdays(userId);
					await reply(birthdays, replyToken);
					break;
				case CHRONOS_EVENT_TYPE.delete:
					redisClient.hSet(userId, REDIS_KEY.status, CHRONOS_USER_STATUS.delete);
					await reply("誕生日を削除する人の名前を入力してください", replyToken);
					break;
				default:
					reply("「誕生日の追加」、「誕生日の一覧」、「誕生日の削除」のいずれかを入力してください", replyToken);
			}
		}
	} catch (error) {
		if (error instanceof ReplyError) {
			await reply(error.message, replyToken);
			console.error(`ERROR: ${error}`);
			console.error(`BACKTRACE: ${error.stack}`);
		} else if (error instanceof Error) {
			await redisClient.del(userId);
			await reply("予期しないエラーが発生しました、最初から操作をやり直してください", replyToken);
			console.error(`ERROR: ${error}`);
			console.error(`BACKTRACE: ${error.stack}`);
		}
	}

	await redisClient.disconnect();
};

// Each Process
const registerOrEnableUser = async (userId: string) => {
	const userSearchQuery = `
		SELECT * FROM user_accounts WHERE id = ? AND active = false LIMIT 1;
	`;
	const userInsertQuery = `
		INSERT INTO user_accounts (id, active, created_at, updated_at) VALUES (?, true, Now(), Now());
	`;
	const enableUserQuery = `
		UPDATE user_accounts SET active = true, updated_at = Now() WHERE id = ? AND active = false;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [disabledUser] = await connect.query<any[]>(userSearchQuery, [userId]);
	const isAlreadyRegisteredUser = !!disabledUser.length;
	await connect.execute<ResultSetHeader>(isAlreadyRegisteredUser ? enableUserQuery : userInsertQuery, [userId]);
	await connect.end();
	return isAlreadyRegisteredUser;
};

const disableUser = async (userId: string) => {
	const userDisableQuery = `
		UPDATE user_accounts SET active = false, updated_at = Now() WHERE id = ? AND active = true;
	`;
	const connect = await mysql.createConnection(dbConfig);
	await connect.execute<ResultSetHeader>(userDisableQuery, [userId]);
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
		throw new ReplyError("登録したい人の名前を正しく入力してください");
	}
	if (!userId) {
		throw new Error("userId not found");
	}
	if (!name) {
		throw new Error("Name not found");
	}
	const regEx = /^(19\d{2}|20\d{2})?\/?(0[1-9]|1\d|2\d|[1-9])\/(0[1-9]|1\d|2\d|3[01]|[1-9])$/;
	const result = text.match(regEx);
	if (!result) {
		throw new ReplyError("誕生日の入力は 1996/12/20 の形式で入力してください\nまた 12/20の形式でも問題ありません");
	}
	const [year, month, date] = [result[1] ? result[1] : null, result[2], result[3]];
	const connect = await mysql.createConnection(dbConfig);
	const inputBirthdayQuery = `
		INSERT INTO birthdays (user_account_id, name, year, month, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, Now(), Now());
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
		DELETE FROM birthdays WHERE user_account_id = ? AND name = ?;
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

class ReplyError extends Error {
	static {
		this.prototype.name = "ReplyError";
	}
	constructor(e?: string) {
		super(e);
	}
}
