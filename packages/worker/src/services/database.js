const { Pool } = require('pg');

class DatabaseService {
  constructor() {
    this.pool = new Pool({
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DB,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: (process.env.PG_SSL === 'true' || process.env.PG_SSL === 'require') ? { rejectUnauthorized: false } : false
    });
    this.pool.on('error', (err) => { console.error('Unexpected error on idle client', err); });
  }

  async testConnection() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error.message);
      return false;
    }
  }

  async saveListing(listingData, jobData) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Insert or update listing
      const listingQuery = `
        INSERT INTO listings (
          external_id, country, client_name, area_name, listing_type,
          address, suburb, state, postcode, price, bedrooms, bathrooms,
          car_spaces, land_size, floor_size, property_type, listing_url,
          scraped_at, raw_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18)
        ON CONFLICT (external_id, country) 
        DO UPDATE SET 
          price = EXCLUDED.price,
          scraped_at = NOW(),
          raw_data = EXCLUDED.raw_data
        RETURNING id`;

      const listingValues = [
        listingData.external_id,
        jobData.country,
        jobData.client_name,
        jobData.area_name,
        listingData.listing_type || 'buy',
        listingData.address || '',
        listingData.suburb || '',
        listingData.state || '',
        listingData.postcode || '',
        listingData.price || null,
        listingData.bedrooms || null,
        listingData.bathrooms || null,
        listingData.car_spaces || null,
        listingData.land_size || null,
        listingData.floor_size || null,
        listingData.property_type || '',
        listingData.listing_url || '',
        JSON.stringify(listingData.raw_data || {})
      ];

      const listingResult = await client.query(listingQuery, listingValues);
      const listingId = listingResult.rows[0].id;

      // Insert snapshot
      const snapshotQuery = `
        INSERT INTO snapshots (
          listing_id, price, status, scraped_at, raw_data
        ) VALUES ($1, $2, $3, NOW(), $4)`;

      const snapshotValues = [
        listingId,
        listingData.price || null,
        listingData.status || 'active',
        JSON.stringify(listingData.raw_data || {})
      ];

      await client.query(snapshotQuery, snapshotValues);
      await client.query('COMMIT');

      return { success: true, listingId, external_id: listingData.external_id };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving listing:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseService;