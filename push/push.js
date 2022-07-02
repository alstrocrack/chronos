/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */

const axios = require('axios');
// const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const CHANNEL_ACCESS_TOKEN = 'projects/199194440168/secrets/CHANNEL_ACCESS_TOKEN';
const TO = 'projects/199194440168/secrets/TO';

// const client = new SecretManagerServiceClient();

exports.push = (event, context) => {
	push('hello');
};

// async function getSecret() {
// 	const [secret] = await client.getSecret({
// 		to: TO,
// 		channelAccessToken: CHANNEL_ACCESS_TOKEN,
// 	});
// 	return [secret];
// }

async function push(message = null) {
	await axios({
		method: 'post',
		url: 'https://api.line.me/v2/bot/message/push',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`,
		},
		data: {
			to: process.env.TO,
			messages: [
				{
					'type': 'text',
					'text': message,
				},
			],
		},
	})
		.then((response) => {
			console.log(response);
		})
		.catch((error) => {
			console.log(error);
		});
}
