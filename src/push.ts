import * as line from "@line/bot-sdk";
import { Message, ClientConfig } from "@line/bot-sdk";
import mysql from "mysql2/promise";
import { ConnectionOptions } from "mysql2";

import { Birthday } from "./type";

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

// handler
export const handler = async (event: any) => {
	const currentTime = new Date();
	const [month, date] = [currentTime.getMonth() + 1, currentTime.getDate()];
	const birthdays = await fetchTodayBirthdays(month, date);
	birthdays.forEach((birthday: Birthday) => {
		const text = birthday.year
			? `今日は${birthday.name}さんの${currentTime.getFullYear() - birthday.year}歳の誕生日です！`
			: `今日は${birthday.name}さんの誕生日です！`;
		push(birthday.id, text);
	});
	console.info(`${currentTime.getFullYear()}年${month}月${date}日 全通知の完了`);
};

const fetchTodayBirthdays = async (month: number, date: number) => {
	const SearchBirthdayQuery = `
		SELECT user_accounts.id AS id, birthdays.name AS name, birthdays.year AS year, birthdays.month AS month, birthdays.date AS date
		FROM birthdays
		JOIN user_accounts
		ON birthdays.user_account_id = user_accounts.id
		WHERE user_accounts.active = true AND birthdays.month = ? AND birthdays.date = ?;
	`;
	const connect = await mysql.createConnection(dbConfig);
	const [birthdays] = await connect.query<Birthday[]>(SearchBirthdayQuery, [month, date]);
	await connect.end();
	return birthdays;
};

// general
const push = async (to: string, text: string) => {
	const client = new line.Client(lineConfig);
	const message: Message = {
		type: "text",
		text: text,
	};
	return await client.pushMessage(to, message);
};
