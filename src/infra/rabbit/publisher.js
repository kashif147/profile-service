import amqplib from "amqplib";
let channel;
export async function initRabbit() {
  const conn = await amqplib.connect(process.env.RABBIT_URL);
  channel = await conn.createChannel();
  await channel.assertExchange("domain.events", "topic", { durable: true });
}
export async function publishEvent(routingKey, payload) {
  if (!channel) await initRabbit();
  channel.publish(
    "domain.events",
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { contentType: "application/json", persistent: true }
  );
}
