import { describe, expect, it } from 'vitest'
import { openApiDocument } from '../openapi.js'

describe('export OpenAPI contract', () => {
  it('documents normal and delegated authentication for GET /exports/me', () => {
    const operation = openApiDocument.paths?.['/exports/me']?.get as any

    expect(operation).toBeDefined()
    expect(operation.security).toEqual(expect.arrayContaining([
      { bearerAuth: [] },
      { exportDelegationAuth: [] },
    ]))
    expect(operation.description).toMatch(/direct|normal/i)
    expect(operation.description).toMatch(/delegat/i)
    expect(operation.responses).toHaveProperty('401')

    expect(openApiDocument.components?.securitySchemes?.exportDelegationAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
  })

  it('publishes the versioned Glocke envelope and complete notification schema', () => {
    const operation = openApiDocument.paths?.['/exports/me']?.get as any
    expect(operation).toBeDefined()
    const schema = operation.responses['200'].content['application/json'].schema

    expect(schema.required).toEqual(expect.arrayContaining(['version', 'service', 'exportedAt', 'data']))
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.version).toMatchObject({ type: 'string', enum: ['1'] })
    expect(schema.properties.service).toMatchObject({ type: 'string', enum: ['glocke'] })
    expect(schema.properties.exportedAt).toMatchObject({ type: 'string', format: 'date-time' })
    expect(schema.properties.data.required).toContain('notifications')
    expect(schema.properties.data.additionalProperties).toBe(false)

    const notifications = schema.properties.data.properties.notifications
    expect(notifications).toMatchObject({ type: 'array' })
    expect(notifications.items.additionalProperties).toBe(false)
    expect(notifications.items.required).toEqual(expect.arrayContaining([
      'id', 'eventId', 'source', 'type', 'title', 'body', 'actionUrl', 'createdAt', 'readAt',
    ]))
    expect(notifications.items.properties.readAt).toMatchObject({
      type: 'string',
      format: 'date-time',
      nullable: true,
    })

    expect(schema.properties).not.toHaveProperty('inbox')
    expect(schema.properties.data.properties).not.toHaveProperty('inbox')
    expect(notifications.items.properties).not.toHaveProperty('userId')
    expect(notifications.items.properties).not.toHaveProperty('leaseId')
    expect(notifications.items.properties).not.toHaveProperty('payloadHash')
  })
})
