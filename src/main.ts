import * as line from '@line/bot-sdk';

const config = {
	channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN!,
	channelSecret: process.env.CHANNEL_SECRET!,
};

export const handler = async (event: any, context: any) => {
	const client = new line.Client(config);

	const message: line.Message = {
		type: 'text',
		text: 'hello',
	};

	await client.pushMessage(process.env.MY_ACCOUNT!, message);
};
