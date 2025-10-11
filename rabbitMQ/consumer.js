const amqplib = require("amqplib");

let channel;
let connection;
const consumers = new Map();

async function initConsumer() {
  if (connection) return;

  const url = process.env.RABBIT_URL || "amqp://localhost:5672";
  console.log(
    "🔗 [CONSUMER] Connecting to RabbitMQ:",
    url.replace(/\/\/.*@/, "//***@")
  ); // Hide credentials

  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  // Assert exchanges to ensure they exist
  await channel.assertExchange("portal.events", "topic", { durable: true });

  console.log("✅ RabbitMQ consumer initialized");
  console.log("✅ Exchange asserted: portal.events");

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

async function createQueue(queueName, exchangeName, routingKeys = []) {
  if (!channel) await initConsumer();

  await channel.assertQueue(queueName, { durable: true });

  // Bind to exchange with routing keys
  for (const routingKey of routingKeys) {
    await channel.bindQueue(queueName, exchangeName, routingKey);
    console.log("✅ Queue bound:", {
      queue: queueName,
      exchange: exchangeName,
      routingKey: routingKey,
    });
  }

  console.log("✅ Queue created:", queueName);
}

async function consumeQueue(queueName, handler) {
  if (!channel) await initConsumer();

  console.log(`🎧 [CONSUMER] Starting to consume queue: ${queueName}`);

  const consumer = await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;
      const exchange = msg.fields.exchange;

      console.log("📥 [CONSUMER] Message received:", {
        queueName,
        exchange,
        routingKey,
        eventId: payload.eventId,
        eventType: payload.eventType,
        timestamp: new Date().toISOString(),
      });

      await handler(payload, routingKey, msg);
      channel.ack(msg);

      console.log("✅ [CONSUMER] Message processed successfully:", {
        queueName,
        routingKey,
        eventId: payload.eventId,
      });
    } catch (error) {
      console.error("❌ [CONSUMER] Error processing message:", {
        error: error.message,
        stack: error.stack,
        queueName,
        routingKey: msg.fields.routingKey,
      });
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
