import { Kafka, Producer, Consumer, Admin, logLevel } from 'kafkajs';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
export const KAFKA_TOPIC = 'area-monitoring-requests';

const kafka = new Kafka({
  clientId: 'eco-sentry',
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.WARN,
});

async function ensureTopicExists() {
  const admin: Admin = kafka.admin();
  await admin.connect();
  const existing = await admin.listTopics();
  if (!existing.includes(KAFKA_TOPIC)) {
    await admin.createTopics({
      topics: [{ topic: KAFKA_TOPIC, numPartitions: 1, replicationFactor: 1 }],
    });
    console.log(`[Kafka] Created topic: ${KAFKA_TOPIC}`);
  }
  await admin.disconnect();
}

export class DeforestationProducer {
  private producer: Producer;
  private connected = false;

  constructor() {
    this.producer = kafka.producer();
  }

  async connect() {
    if (!this.connected) {
      await ensureTopicExists();
      await this.producer.connect();
      this.connected = true;
      console.log('[Kafka] Producer connected');
    }
  }

  async send(message: any) {
    await this.connect();
    await this.producer.send({
      topic: KAFKA_TOPIC,
      messages: [{ value: JSON.stringify(message) }],
    });
    console.log(`[Kafka] Produced message for AOI: ${message.aoi_id}`);
  }
}

export class DeforestationConsumer {
  private consumer: Consumer;

  constructor() {
    this.consumer = kafka.consumer({ groupId: 'eco-sentry-workers' });
  }

  async onMessage(callback: (message: any) => Promise<void>) {
    await ensureTopicExists();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          const parsed = JSON.parse(message.value.toString());
          await callback(parsed);
        }
      },
    });
    console.log(`[Kafka] Consumer listening on topic: ${KAFKA_TOPIC}`);
  }
}
