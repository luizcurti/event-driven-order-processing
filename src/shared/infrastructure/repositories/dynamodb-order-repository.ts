import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { OrderRepository } from '../../application/ports';
import type { Order, OrderStatus } from '../../domain/order';

import { OrderNotFoundException } from '../../errors/app-errors';
import { createDynamoDbClientConfig } from '../aws-client-config';

interface OrderRecord extends Order {
  pk: string;
  sk: string;
}

export class DynamoDbOrderRepository implements OrderRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    dynamoClient = new DynamoDBClient(createDynamoDbClientConfig())
  ) {
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  async create(order: Order): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.toRecord(order),
        ConditionExpression: 'attribute_not_exists(pk)'
      })
    );
  }

  async findById(orderId: string): Promise<Order | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `ORDER#${orderId}`,
          sk: 'ORDER'
        }
      })
    );

    if (!result.Item) {
      return null;
    }

    return this.fromRecord(result.Item as OrderRecord);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'IdempotencyIndex',
        KeyConditionExpression: 'idempotencyKey = :idempotencyKey',
        ExpressionAttributeValues: {
          ':idempotencyKey': idempotencyKey
        },
        Limit: 1
      })
    );

    const firstItem = result.Items?.[0];

    return firstItem ? this.fromRecord(firstItem as OrderRecord) : null;
  }

  async list(): Promise<Order[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'sk = :sk',
        IndexName: 'OrderTypeIndex',
        ExpressionAttributeValues: {
          ':sk': 'ORDER'
        }
      })
    );

    return (result.Items ?? [])
      .map((item) => this.fromRecord(item as OrderRecord))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `ORDER#${orderId}`,
          sk: 'ORDER'
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': new Date().toISOString()
        },
        ReturnValues: 'ALL_NEW'
      })
    );

    if (!result.Attributes) {
      throw new OrderNotFoundException(orderId);
    }

    return this.fromRecord(result.Attributes as OrderRecord);
  }

  private toRecord(order: Order): OrderRecord {
    return {
      ...order,
      pk: `ORDER#${order.id}`,
      sk: 'ORDER'
    };
  }

  private fromRecord(record: OrderRecord): Order {
    const { pk, sk, ...order } = record;
    void pk;
    void sk;

    return order;
  }
}