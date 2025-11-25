import { mobileMeshService } from './mobileMeshService';

export async function initializeServices() {
  console.log('Initializing BlockStar services...');
  
  try {
    // Initialize mesh networking
    await mobileMeshService.initialize();
    console.log('Mesh service initialized');
  } catch (error) {
    console.warn('Some services failed to initialize:', error);
  }
}

export { mobileMeshService };
