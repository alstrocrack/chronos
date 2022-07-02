/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */

const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const CHANNEL_ACCESS_TOKEN = 'projects/199194440168/secrets/CHANNEL_ACCESS_TOKEN/versions/latest';
const TO = 'projects/199194440168/secrets/TO/versions/latest';

const client = new SecretManagerServiceClient();

exports.push = async (event, context) => {
	const cat = await accessSecretVersion(CHANNEL_ACCESS_TOKEN);
	const to = await accessSecretVersion(TO);
	console.error(`cat: ${cat}`);
	console.error(`to: ${to}`);
	push(cat, to, 'hello');
};

async function accessSecretVersion(key) {
	const [version] = await client.accessSecretVersion({
		name: key,
	});

	// Extract the payload as a string.
	const payload = version.payload.data.toString();

	// WARNING: Do not print the secret in a production environment - this
	// snippet is showing how to access the secret material.
	console.info(`Payload: ${payload}`);
	return payload;
}

async function push(cat, to, message = null) {
	await axios({
		method: 'post',
		url: 'https://api.line.me/v2/bot/message/push',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${cat}`,
		},
		data: {
			to: to,
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
		})
		.finally(() => {
			// console.error(`cat: ${accessSecretVersion(CHANNEL_ACCESS_TOKEN)}`);
			// console.error(`to: ${accessSecretVersion(TO)}`);
		});
}
