/**
 * @file src/routes/api/setup/seed/+server.ts
 * @description Writes private.ts and seeds default data
 * @summary
 *  - Called when user clicks "Next" after successful DB test
 *  - STEP 1: Writes private.ts with DB credentials and security keys
 *  - STEP 2: Seeds settings and themes
 *  - Gives Vite time to pick up new private.ts file
 *  - Returns quickly so user can proceed to admin form
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logger } from '@utils/logger.server';
import type { DatabaseConfig } from '@src/databases/schemas';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const dbConfig = (await request.json()) as DatabaseConfig;
		const isDemo = env.SVELTYCMS_DEMO === 'true';

		logger.info(' Starting setup initialization...', {
			host: dbConfig.host,
			port: dbConfig.port,
			name: dbConfig.name,
			demo: isDemo
		});

		// STEP 1: Write private.ts with database credentials
		logger.info('📝 Writing private.ts configuration file...');
		const { writePrivateConfig } = await import('../writePrivateConfig');
		await writePrivateConfig(dbConfig);
		logger.info('✅ Private configuration file written');

		if (isDemo) {
			const privateConfigPath = path.resolve(process.cwd(), 'config', 'private.ts');
			let privateConfigFileContent = await fs.readFile(privateConfigPath, 'utf8');

			// Enable MULTI_TENANT for demo mode
			privateConfigFileContent = privateConfigFileContent.replace('MULTI_TENANT: false,', 'MULTI_TENANT: true,');
            
            // Add DEMO flag (this will be picked up by schemas.ts and then by db.ts)
			privateConfigFileContent += '\nexport const DEMO = true;\n';

			await fs.writeFile(privateConfigPath, privateConfigFileContent, 'utf8');
			logger.info('✅ DEMO flag and MULTI_TENANT enabled in private.ts');
		}

		// STEP 2: Asynchronously seed database and get first collection for quick redirect
		logger.info('Pre-scanning collections for faster redirect...');
		const { scanCompiledCollections } = await import('@src/content/collectionScanner');
		const collections = await scanCompiledCollections();
		const firstCollection = collections.length > 0 ? { name: collections[0].name, path: collections[0].path, _id: collections[0]._id } : null;
		logger.info(`Found ${collections.length} collections. First collection for redirect: ${firstCollection?.name} (ID: ${firstCollection?._id})`);

		// Run the full seeding process in the background
		const { initSystemFromSetup } = await import('../seed');
		const { getSetupDatabaseAdapter } = await import('../utils');

		const seedProcess = async () => {
			try {
				logger.info('📦 Getting setup database adapter for background seeding...');
				const { dbAdapter } = await getSetupDatabaseAdapter(dbConfig);
				logger.info('🌱 Starting background seeding of default data (settings, themes, collections)...');
				await initSystemFromSetup(dbAdapter);
			} catch (seedError) {
				logger.error('❌ Background seeding process failed:', seedError);
			}
		};
		seedProcess(); // Fire-and-forget

		// Return response immediately
		logger.info('✅ Immediately returning response while seeding continues in background.');

		// Success message removed - "System initialization completed" already logged in seed.ts
		// Hook will log the final completion with timing

		return json({
			success: true,
			message: 'Database initialized successfully! ✨',
			firstCollection // Return first collection info for faster redirect
		});
	} catch (error) {
		const errorDetails = {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			type: error?.constructor?.name,
			fullError: error
		};

		logger.error('❌ Setup initialization failed:', errorDetails);

		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error),
				details: errorDetails,
				message: 'Initialization failed, but you can continue. Data will be created on first use.'
			},
			{ status: 500 }
		);
	}
};
