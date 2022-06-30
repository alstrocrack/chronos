/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */

const axios = require('axios');

exports.push = (event, context) => {
	const message = event.data ? Buffer.from(event.data, 'base64').toString() : 'Hello, World';
	push(message);
};

async function push(message) {
	await axios
		.post('https://api.line.me/v2/bot/message/push', {
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
