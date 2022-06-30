/**
 * Triggered from a message on a Cloud Pub/Sub topic.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.push = (event, context) => {
	const message = event.data ? Buffer.from(event.data, 'base64').toString() : 'Hello, World';
	console.log(message);
};
