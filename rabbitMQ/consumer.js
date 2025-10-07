const amqplib = require("amqplib");

let channel;
let connection;
const consumers = new Map();

async function initConsumer() {
  if (connection) return;

  const url = process.env.RABBIT_URL || "amqp://localhost:5672";
  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  console.log("✅ RabbitMQ consumer initialized");

  // Handle connection events
  connection.on("error", (err) => {
    console.warn("❌ RabbitMQ consumer connection error:", err.message);
  });

  connection.on("close", () => {
    console.warn("⚠️ RabbitMQ consumer connection closed");
    channel = null;
    connection = null;
    consumers.clear();
  });

  channel.on("error", (err) => {
    console.warn("❌ RabbitMQ consumer channel error:", err.message);
  });

  channel.on("close", () => {
    console.warn("⚠️ RabbitMQ consumer channel closed");
    channel = null;
    consumers.clear();
  });
}

async function createQueue(queueName, routingKeys = []) {
  if (!channel) await initConsumer();

  await channel.assertQueue(queueName, { durable: true });

  // Bind to exchange with routing keys
  for (const routingKey of routingKeys) {
    await channel.bindQueue(queueName, "domain.events", routingKey);
  }

  console.log("✅ Queue created and bound:", queueName, routingKeys);
}

async function consumeQueue(queueName, handler) {
  if (!channel) await initConsumer();

  const consumer = await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;

      console.log("📥 Processing message:", {
        queueName,
        routingKey,
        eventId: payload.eventId,
      });

      await handler(payload, routingKey, msg);
      channel.ack(msg);
    } catch (error) {
      console.error("❌ Error processing message:", error.message);
      channel.nack(msg, false, false); // Don't requeue on error
    }
  });

  consumers.set(queueName, consumer);
  console.log("✅ Consumer started:", queueName);
}

async function stopAllConsumers() {
  for (const [queueName, consumer] of consumers) {
    try {
      await channel.cancel(consumer.consumerTag);
      console.log("✅ Consumer stopped:", queueName);
    } catch (error) {
      console.warn("⚠️ Error stopping consumer:", error.message);
    }
  }
  consumers.clear();
}

module.exports = {
  initConsumer,
  createQueue,
  consumeQueue,
  stopAllConsumers,
};
