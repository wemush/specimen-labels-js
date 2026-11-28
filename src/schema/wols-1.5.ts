/**
 * WOLS 1.5 JSON Schemas (draft 2020-12), transcribed from the normative
 * schema/1.5/label.schema.json and schema/1.5/bundle.schema.json in
 * wemush/open-standard with the annotation keywords (description, title,
 * examples, $comment, deprecated) removed.
 *
 * Do not edit by hand. tests/unit/schema-drift.test.ts checks these against
 * the vendored copies in tests/conformance/schema/1.5/.
 *
 * @module schema/wols-1.5
 * @internal
 */

import type { JsonSchema } from './evaluate.js';

/** schema/1.5/label.schema.json */
export const LABEL_SCHEMA_1_5: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wemush.com/wols/schema/1.5/label.schema.json',
  type: 'object',
  required: ['@context', '@type', 'id', 'version', 'type', 'species'],
  properties: {
    '@context': { const: 'https://wemush.com/wols/v1' },
    '@type': { const: 'Specimen' },
    id: { $ref: '#/$defs/SpecimenId' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$' },
    type: { $ref: '#/$defs/SpecimenType' },
    species: { type: 'string', minLength: 1 },
    taxon: { $ref: '#/$defs/Taxon' },
    form: { $ref: '#/$defs/SpecimenForm' },
    strain: { $ref: '#/$defs/Strain' },
    derivedFrom: { type: 'array', minItems: 1, items: { $ref: '#/$defs/ParentLink' } },
    stage: { $ref: '#/$defs/GrowthStage' },
    condition: { $ref: '#/$defs/Condition' },
    container: { $ref: '#/$defs/Container' },
    created: { type: 'string', format: 'date-time' },
    batch: { type: 'string', minLength: 1 },
    lot: { type: 'string', minLength: 1 },
    organization: { type: 'string', minLength: 1 },
    creator: { type: 'string', minLength: 1 },
    custom: { type: 'object', additionalProperties: { type: 'object' } },
    _meta: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        sourceSystem: { type: 'string' },
        importedAt: { type: 'string', format: 'date-time' },
        schemaVersion: { type: 'string' },
      },
      additionalProperties: true,
    },
    signature: { type: 'string' },
  },
  additionalProperties: true,
  $defs: {
    SpecimenId: { type: 'string', pattern: '^wemush:.+$' },
    SpecimenType: { enum: ['CULTURE', 'SPAWN', 'SUBSTRATE', 'FRUITING', 'HARVEST'] },
    SpecimenForm: {
      anyOf: [
        {
          enum: [
            'AGAR_PLATE',
            'SLANT',
            'TISSUE_CULTURE',
            'LIQUID_CULTURE',
            'SPORE_SYRINGE',
            'SPORE_PRINT',
            'SPORE_SWAB',
            'GRAIN_SPAWN',
            'SAWDUST_SPAWN',
            'PLUG_SPAWN',
            'SUBSTRATE_BLOCK',
            'BULK_SUBSTRATE',
            'FRUITING_BLOCK',
            'FRUITING_BAG',
            'LOG',
            'BED',
            'FRESH',
            'DRIED',
            'PROCESSED',
            'EXTRACT',
            'LIVE_SAMPLE',
          ],
        },
        { type: 'string', pattern: '^x-[a-z0-9-]+$' },
      ],
    },
    GrowthStage: {
      enum: [
        'INOCULATION',
        'INCUBATION',
        'COLONIZATION',
        'PRIMORDIA',
        'FRUITING',
        'SENESCENCE',
        'HARVEST',
      ],
    },
    Condition: { enum: ['ACTIVE', 'CONTAMINATED', 'EXHAUSTED', 'DISPOSED', 'ARCHIVED'] },
    Container: {
      type: 'object',
      required: ['format'],
      properties: {
        format: {
          anyOf: [
            {
              enum: [
                'PETRI_DISH',
                'SLANT_TUBE',
                'JAR',
                'BOTTLE',
                'CARBOY',
                'SYRINGE',
                'BAG',
                'MONOTUB',
                'BUCKET',
                'COMPRESSED_BLOCK',
                'TRAY',
                'OTHER',
              ],
            },
            { type: 'string', pattern: '^x-[a-z0-9-]+$' },
          ],
        },
        capacity: { $ref: '#/$defs/Quantity' },
      },
      additionalProperties: false,
    },
    Taxon: {
      type: 'object',
      required: ['scientificName'],
      properties: {
        scientificName: { type: 'string', minLength: 1 },
        authorship: { type: 'string' },
        rank: { enum: ['species', 'subspecies', 'variety', 'form', 'genus', 'hybrid'] },
        identifiers: { type: 'array', items: { $ref: '#/$defs/TaxonIdentifier' } },
        hybridOf: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            required: ['scientificName'],
            properties: {
              scientificName: { type: 'string', minLength: 1 },
              role: { enum: ['PARENT_A', 'PARENT_B', 'UNKNOWN'] },
              identifiers: { type: 'array', items: { $ref: '#/$defs/TaxonIdentifier' } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    TaxonIdentifier: {
      type: 'object',
      required: ['scheme', 'value'],
      properties: {
        scheme: { enum: ['mycobank', 'indexfungorum', 'gbif', 'col', 'inaturalist', 'ncbi'] },
        value: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    Strain: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        generation: {
          oneOf: [
            { type: 'string', pattern: '^([FfGg][0-9]+|[Pp][0-9]*|[0-9]+)$' },
            { type: 'integer', minimum: 0 },
          ],
        },
        clonalGeneration: { type: 'integer', minimum: 0 },
        transferDepth: { type: 'integer', minimum: 0 },
        lineage: { $ref: '#/$defs/SpecimenId' },
        source: { type: 'string' },
        accession: { type: 'string' },
      },
      additionalProperties: true,
    },
    ParentLink: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { $ref: '#/$defs/SpecimenId' },
        relation: {
          enum: [
            'SUBCULTURE',
            'EXPANSION',
            'SPAWN_TO_BULK',
            'COMBINED',
            'CLONE',
            'SPORE_ISOLATE',
            'CROSS',
            'REPACK',
          ],
        },
        quantity: { $ref: '#/$defs/Quantity' },
      },
      additionalProperties: false,
    },
    Quantity: {
      type: 'object',
      required: ['value', 'unit'],
      properties: { value: { type: 'number' }, unit: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
  },
};

/** schema/1.5/bundle.schema.json */
export const BUNDLE_SCHEMA_1_5: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wemush.com/wols/schema/1.5/bundle.schema.json',
  type: 'object',
  required: ['@context', '@type', 'version', 'specimens'],
  properties: {
    '@context': { const: 'https://wemush.com/wols/v1' },
    '@type': { const: 'Bundle' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$' },
    generated: { type: 'string', format: 'date-time' },
    publisher: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        organization: { type: 'string' },
        contact: { type: 'string', format: 'uri' },
      },
      additionalProperties: false,
    },
    license: { type: 'string' },
    specimens: { type: 'array', items: { $ref: '#/$defs/SpecimenRecord' } },
    strains: { type: 'array', items: { $ref: '#/$defs/StrainRecord' } },
    recipes: { type: 'array', items: { $ref: '#/$defs/Recipe' } },
    observations: { type: 'array', items: { $ref: '#/$defs/Observation' } },
    harvests: { type: 'array', items: { $ref: '#/$defs/Harvest' } },
  },
  additionalProperties: false,
  $defs: {
    SpecimenRecord: {
      allOf: [
        { $ref: 'label.schema.json' },
        {
          type: 'object',
          properties: {
            strainRef: { type: 'string' },
            recipeRef: { type: 'string' },
            inoculatedAt: { type: 'string', format: 'date-time' },
            inoculum: { $ref: 'label.schema.json#/$defs/Quantity' },
            substrateWetWeight: { $ref: 'label.schema.json#/$defs/Quantity' },
            substrateDryWeight: { $ref: 'label.schema.json#/$defs/Quantity' },
            location: { $ref: '#/$defs/Location' },
            circularEconomy: { $ref: '#/$defs/CircularEconomy' },
          },
        },
      ],
    },
    StrainRecord: {
      type: 'object',
      required: ['id', 'name', 'taxon'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        aliases: { type: 'array', items: { type: 'string' } },
        taxon: { $ref: 'label.schema.json#/$defs/Taxon' },
        accession: { type: 'string' },
        origin: { type: 'string' },
        isolatedAt: { type: 'string', format: 'date' },
        isolationSource: { type: 'string' },
        growthParameters: {
          type: 'object',
          properties: {
            colonization: { $ref: '#/$defs/EnvironmentRange' },
            fruiting: { $ref: '#/$defs/EnvironmentRange' },
            incubationDays: { $ref: '#/$defs/Range' },
            fruitingDays: { $ref: '#/$defs/Range' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    Recipe: {
      type: 'object',
      required: ['id', 'name', 'kind', 'ingredients'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        kind: { enum: ['AGAR', 'LIQUID_CULTURE', 'GRAIN', 'SUBSTRATE', 'CASING', 'OTHER'] },
        ingredients: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['name', 'amount'],
            properties: {
              name: { type: 'string', minLength: 1 },
              amount: { $ref: 'label.schema.json#/$defs/Quantity' },
              role: {
                enum: ['BASE', 'SUPPLEMENT', 'WATER', 'ADDITIVE', 'GELLING_AGENT', 'NUTRIENT'],
              },
              supplier: { type: 'string' },
              foodonId: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        yields: { $ref: 'label.schema.json#/$defs/Quantity' },
        hydration: { $ref: 'label.schema.json#/$defs/Quantity' },
        treatment: {
          type: 'object',
          required: ['method'],
          properties: {
            method: {
              enum: [
                'AUTOCLAVE',
                'PRESSURE_COOKER',
                'PASTEURIZATION',
                'LIME',
                'COLD_WATER',
                'NONE',
                'OTHER',
              ],
            },
            temperature: { $ref: 'label.schema.json#/$defs/Quantity' },
            duration: { $ref: 'label.schema.json#/$defs/Quantity' },
            pressure: { $ref: 'label.schema.json#/$defs/Quantity' },
          },
          additionalProperties: false,
        },
        instructions: { type: 'string' },
      },
      additionalProperties: false,
    },
    Observation: {
      type: 'object',
      required: ['id', 'specimen', 'observedAt', 'kind'],
      properties: {
        id: { type: 'string', minLength: 1 },
        specimen: { $ref: 'label.schema.json#/$defs/SpecimenId' },
        observedAt: { type: 'string', format: 'date-time' },
        recordedAt: { type: 'string', format: 'date-time' },
        kind: {
          enum: [
            'NOTE',
            'MEASUREMENT',
            'ENVIRONMENT',
            'STAGE_CHANGE',
            'CONDITION_CHANGE',
            'CONTAMINATION',
            'INSPECTION',
            'PHOTO',
          ],
        },
        stage: { $ref: 'label.schema.json#/$defs/GrowthStage' },
        condition: { $ref: 'label.schema.json#/$defs/Condition' },
        measurements: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string', pattern: '^([a-z][A-Za-z0-9]*|[a-z0-9_]+:[A-Za-z0-9_]+)$' },
              value: { type: ['number', 'string', 'boolean'] },
              unit: { type: 'string' },
              method: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        environment: { $ref: '#/$defs/Environment' },
        contamination: {
          type: 'object',
          properties: {
            agent: {
              enum: [
                'TRICHODERMA',
                'BACTERIA',
                'COBWEB',
                'PENICILLIUM',
                'ASPERGILLUS',
                'RHIZOPUS',
                'LIPSTICK',
                'YEAST',
                'UNKNOWN',
                'OTHER',
              ],
            },
            suspectedTaxon: { $ref: 'label.schema.json#/$defs/Taxon' },
            severity: { enum: ['SUSPECTED', 'LOCALIZED', 'SPREADING', 'TOTAL'] },
            action: { enum: ['MONITOR', 'ISOLATE', 'DISCARD', 'TREAT'] },
          },
          additionalProperties: false,
        },
        outcome: {
          enum: ['SUCCESS', 'PARTIAL_SUCCESS', 'CONTAMINATION', 'FAILURE', 'INCONCLUSIVE'],
        },
        note: { type: 'string' },
        media: {
          type: 'array',
          items: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', format: 'uri' },
              mediaType: { type: 'string' },
              license: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        location: { $ref: '#/$defs/Location' },
        source: {
          type: 'object',
          properties: {
            kind: { enum: ['MANUAL', 'SENSOR', 'IMPORT', 'AI_ASSISTED'] },
            device: { type: 'string' },
            software: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    Harvest: {
      type: 'object',
      required: ['id', 'specimen', 'harvestedAt', 'freshWeight'],
      properties: {
        id: { type: 'string', minLength: 1 },
        specimen: { $ref: 'label.schema.json#/$defs/SpecimenId' },
        harvestedAt: { type: 'string', format: 'date-time' },
        flush: { type: 'integer', minimum: 1 },
        freshWeight: { $ref: 'label.schema.json#/$defs/Quantity' },
        dryWeight: { $ref: 'label.schema.json#/$defs/Quantity' },
        grade: { enum: ['A', 'B', 'C', 'REJECT', 'UNGRADED'] },
        lot: { type: 'string' },
        output: { $ref: 'label.schema.json#/$defs/SpecimenId' },
        note: { type: 'string' },
      },
      additionalProperties: false,
    },
    Environment: {
      type: 'object',
      properties: {
        temperature: { $ref: 'label.schema.json#/$defs/Quantity' },
        relativeHumidity: { $ref: 'label.schema.json#/$defs/Quantity' },
        co2: { $ref: 'label.schema.json#/$defs/Quantity' },
        light: {
          type: 'object',
          properties: {
            intensity: { $ref: 'label.schema.json#/$defs/Quantity' },
            photoperiod: { $ref: 'label.schema.json#/$defs/Quantity' },
            spectrum: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        freshAirExchangesPerHour: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
    EnvironmentRange: {
      type: 'object',
      properties: {
        temperature: { $ref: '#/$defs/QuantityRange' },
        relativeHumidity: { $ref: '#/$defs/QuantityRange' },
        co2: { $ref: '#/$defs/QuantityRange' },
      },
      additionalProperties: false,
    },
    QuantityRange: {
      type: 'object',
      required: ['unit'],
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
        optimal: { type: 'number' },
        unit: { type: 'string' },
      },
      additionalProperties: false,
    },
    Range: {
      type: 'object',
      properties: { min: { type: 'number' }, max: { type: 'number' } },
      additionalProperties: false,
    },
    Location: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        gln: { type: 'string', pattern: '^[0-9]{13}$' },
      },
      additionalProperties: false,
    },
    CircularEconomy: {
      type: 'object',
      properties: {
        wasteSource: {
          type: 'object',
          properties: {
            type: { enum: ['BREWERY', 'RESTAURANT', 'FARM', 'COFFEE_SHOP', 'OTHER'] },
            partnerId: { type: 'string' },
            collectionDate: { type: 'string', format: 'date' },
            composition: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        sustainability: {
          type: 'object',
          properties: {
            carbonOffset: { $ref: 'label.schema.json#/$defs/Quantity' },
            wasteUtilized: { $ref: 'label.schema.json#/$defs/Quantity' },
            localSourcing: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
};
