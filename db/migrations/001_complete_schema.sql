-- Estate Scraper Complete Schema Migration
-- This creates the full database schema for the estate scraper

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main listings table
CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(100) NOT NULL,
    country VARCHAR(2) NOT NULL CHECK (country IN ('AU', 'NZ')),
    client_name VARCHAR(100) NOT NULL,
    area_name VARCHAR(100) NOT NULL,
    listing_type VARCHAR(20) NOT NULL DEFAULT 'buy' CHECK (listing_type IN ('buy', 'sold', 'rent')),
    
    -- Property details
    address TEXT,
    suburb VARCHAR(100),
    state VARCHAR(50),
    postcode VARCHAR(20),
    
    -- Pricing and specs
    price BIGINT,
    bedrooms INTEGER,
    bathrooms DECIMAL(3,1),
    car_spaces INTEGER,
    land_size INTEGER, -- square meters
    floor_size INTEGER, -- square meters
    property_type VARCHAR(50),
    
    -- Metadata
    listing_url TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Raw data storage
    raw_data JSONB,
    
    -- Ensure uniqueness per source
    UNIQUE(external_id, country)
);

-- Price snapshots for tracking changes over time
CREATE TABLE IF NOT EXISTS snapshots (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    price BIGINT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'sold', 'withdrawn', 'under_contract')),
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    raw_data JSONB
);

-- Job tracking table
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(100) UNIQUE NOT NULL,
    client_name VARCHAR(100) NOT NULL,
    area_name VARCHAR(100) NOT NULL,
    country VARCHAR(2) NOT NULL CHECK (country IN ('AU', 'NZ')),
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    buy_urls TEXT[],
    sold_urls TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    result_data JSONB
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listings_country_client ON listings(country, client_name);
CREATE INDEX IF NOT EXISTS idx_listings_area ON listings(area_name);
CREATE INDEX IF NOT EXISTS idx_listings_scraped_at ON listings(scraped_at);
CREATE INDEX IF NOT EXISTS idx_listings_external_id ON listings(external_id);
CREATE INDEX IF NOT EXISTS idx_listings_suburb_state ON listings(suburb, state);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price) WHERE price IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type);

CREATE INDEX IF NOT EXISTS idx_snapshots_listing_id ON snapshots(listing_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_scraped_at ON snapshots(scraped_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(status);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_client_area ON jobs(client_name, area_name);

-- GIN index for JSONB data
CREATE INDEX IF NOT EXISTS idx_listings_raw_data ON listings USING GIN(raw_data);
CREATE INDEX IF NOT EXISTS idx_snapshots_raw_data ON snapshots USING GIN(raw_data);

-- View for expired/withdrawn listings (haven't been updated recently)
CREATE OR REPLACE VIEW expired_listings AS
SELECT 
    l.*,
    EXTRACT(days FROM NOW() - l.scraped_at) as days_since_update
FROM listings l
WHERE l.scraped_at < NOW() - INTERVAL '30 days'
    AND NOT EXISTS (
        SELECT 1 FROM snapshots s 
        WHERE s.listing_id = l.id 
        AND s.status IN ('sold', 'withdrawn')
        AND s.scraped_at > NOW() - INTERVAL '30 days'
    );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_listings_updated_at ON listings;
CREATE TRIGGER update_listings_updated_at
    BEFORE UPDATE ON listings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to create listing snapshots on price changes
CREATE OR REPLACE FUNCTION create_price_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create snapshot if price changed or it's a new listing
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.price IS DISTINCT FROM NEW.price) THEN
        INSERT INTO snapshots (listing_id, price, status, scraped_at, raw_data)
        VALUES (NEW.id, NEW.price, 'active', NEW.scraped_at, NEW.raw_data);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically create snapshots
DROP TRIGGER IF EXISTS create_listing_snapshot ON listings;
CREATE TRIGGER create_listing_snapshot
    AFTER INSERT OR UPDATE ON listings
    FOR EACH ROW
    EXECUTE FUNCTION create_price_snapshot();

-- Initial data setup
INSERT INTO jobs (job_id, client_name, area_name, country, status, created_at)
VALUES ('initial-setup', 'System', 'Setup', 'AU', 'completed', NOW())
ON CONFLICT (job_id) DO NOTHING;

-- Grant permissions (adjust based on your user setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- Display schema info
SELECT 
    'Schema migration completed successfully' as status,
    COUNT(*) as total_tables
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN ('listings', 'snapshots', 'jobs');