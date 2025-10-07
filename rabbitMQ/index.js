// Main RabbitMQ module exports
const { publishEvent, initRabbit, closePublisher } = require("./publisher.js");
const {
  initConsumer,
  createQueue,
  consumeQueue,
  stopAllConsumers,
} = require("./consumer.js");
const {
  EVENT_TYPES,
  QUEUES,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
} = require("./events.js");

module.exports = {
  publishEvent,
  initRabbit,
  closePublisher,
  initConsumer,
  createQueue,
  consumeQueue,
  stopAllConsumers,
  EVENT_TYPES,
  QUEUES,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
};
