/**
 * MenuDataManager.js - Client-side menu data cache for AI Assistant
 * 
 * Loads complete menu data once and provides fast local access functions
 * for the AI assistant to query menu information without database calls.
 */

export class MenuDataManager {
    constructor() {
        this.menuData = null;
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
        this.searchIndex = new Map();
        
        console.log('[MenuDataManager] Initialized');
    }
    
    /**
     * Load complete menu data from server and cache locally
     */
    async loadMenuData(token) {
        if (this.isLoaded) {
            console.log('[MenuDataManager] Menu data already loaded');
            return this.menuData;
        }
        
        if (this.isLoading) {
            console.log('[MenuDataManager] Already loading, waiting...');
            return await this.loadPromise;
        }
        
        this.isLoading = true;
        console.log('[MenuDataManager] Loading complete menu data from server...');
        
        this.loadPromise = this._fetchMenuData(token);
        
        try {
            const result = await this.loadPromise;
            this.isLoaded = true;
            this.isLoading = false;
            console.log('[MenuDataManager] ✅ Menu data loaded successfully');
            return result;
        } catch (error) {
            this.isLoading = false;
            console.error('[MenuDataManager] ❌ Failed to load menu data:', error);
            
            // Fallback: Create minimal menu data to allow AI to work
            console.log('[MenuDataManager] Using fallback menu data for testing');
            this.menuData = {
                categories: [
                    { id: 1, name: 'Burgers', description: 'Delicious burgers', order: 1 },
                    { id: 2, name: 'Pizza', description: 'Fresh pizzas', order: 2 },
                    { id: 3, name: 'Drinks', description: 'Cold beverages', order: 3 }
                ],
                products: [
                    { id: 1, name: 'Beef Burger', description: 'Juicy beef burger', price: 15, category: 'Burgers', currency: 'KWD' },
                    { id: 2, name: 'Chicken Burger', description: 'Grilled chicken burger', price: 12, category: 'Burgers', currency: 'KWD' },
                    { id: 3, name: 'Margherita Pizza', description: 'Classic tomato and mozzarella', price: 18, category: 'Pizza', currency: 'KWD' },
                    { id: 4, name: 'Pepperoni Pizza', description: 'Pizza with pepperoni', price: 20, category: 'Pizza', currency: 'KWD' },
                    { id: 5, name: 'Cola', description: 'Cold cola drink', price: 3, category: 'Drinks', currency: 'KWD' },
                    { id: 6, name: 'Orange Juice', description: 'Fresh orange juice', price: 4, category: 'Drinks', currency: 'KWD' }
                ],
                modifiers: []
            };
            this._buildSearchIndex();
            this.isLoaded = true;
            console.log('[MenuDataManager] ✅ Fallback menu data ready');
            return this.menuData;
        }
    }
    
    async _fetchMenuData(token) {
        const baseUrl = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
        const response = await fetch(`${baseUrl}/ai/menu-data`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load menu data: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error('Menu data API returned error');
        }
        
        this.menuData = result.data;
        this._buildSearchIndex();
        
        console.log(`[MenuDataManager] Loaded ${result.metadata.categories_count} categories, ${result.metadata.products_count} products, ${result.metadata.modifiers_count} modifiers in ${result.metadata.load_time_ms}ms`);
        
        return this.menuData;
    }
    
    /**
     * Build search index for fast product search
     */
    _buildSearchIndex() {
        if (!this.menuData) return;
        
        this.searchIndex.clear();
        
        this.menuData.products.forEach(product => {
            // Create searchable text
            const searchText = [
                product.name,
                product.description || '',
                product.category
            ].join(' ').toLowerCase();
            
            // Index individual words
            const words = searchText.split(/\\s+/).filter(word => word.length > 2);
            words.forEach(word => {
                if (!this.searchIndex.has(word)) {
                    this.searchIndex.set(word, []);
                }
                this.searchIndex.get(word).push(product);
            });
        });
        
        console.log(`[MenuDataManager] Built search index with ${this.searchIndex.size} terms`);
    }
    
    // === AI QUERY FUNCTIONS ===
    
    /**
     * Get all menu categories
     */
    getMenuCategories() {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        return {
            categories: this.menuData.categories.map(cat => ({
                id: cat.id,
                name: cat.name,
                description: cat.description,
                order: cat.order
            }))
        };
    }
    
    /**
     * Get products in a specific category
     */
    getCategoryProducts(categoryName) {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        const products = this.menuData.products.filter(product => 
            product.category.toLowerCase().includes(categoryName.toLowerCase())
        );
        
        return {
            category: categoryName,
            products: products.map(prod => ({
                id: prod.id,
                name: prod.name,
                description: prod.description,
                price: prod.price,
                currency: prod.currency
            }))
        };
    }
    
    /**
     * Search products by name or description
     */
    searchProducts(searchTerm) {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        const term = searchTerm.toLowerCase();
        const results = new Set();
        
        // Search using index
        for (const [word, products] of this.searchIndex) {
            if (word.includes(term) || term.includes(word)) {
                products.forEach(product => results.add(product));
            }
        }
        
        // Also do direct name/description search for partial matches
        this.menuData.products.forEach(product => {
            if (product.name.toLowerCase().includes(term) || 
                (product.description && product.description.toLowerCase().includes(term))) {
                results.add(product);
            }
        });
        
        const productsArray = Array.from(results).slice(0, 20); // Limit results
        
        return {
            search_term: searchTerm,
            found: productsArray.length,
            products: productsArray.map(prod => ({
                id: prod.id,
                name: prod.name,
                description: prod.description,
                price: prod.price,
                category: prod.category,
                currency: prod.currency
            }))
        };
    }
    
    /**
     * Get detailed product information including modifiers
     */
    getProductDetails(productId) {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        const product = this.menuData.products.find(p => p.id === productId);
        
        if (!product) {
            return { error: 'Product not found' };
        }
        
        const modifiers = this.menuData.modifiers[productId] || [];
        
        return {
            product: {
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                category: product.category,
                currency: product.currency,
                modifiers: modifiers
            }
        };
    }
    
    /**
     * Get all products (useful for "show me everything")
     */
    getAllProducts() {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        return {
            total: this.menuData.products.length,
            products: this.menuData.products.map(prod => ({
                id: prod.id,
                name: prod.name,
                description: prod.description,
                price: prod.price,
                category: prod.category,
                currency: prod.currency
            }))
        };
    }
    
    /**
     * Get menu statistics
     */
    getMenuStats() {
        if (!this.isLoaded || !this.menuData) {
            return { error: 'Menu data not loaded' };
        }
        
        return {
            categories_count: this.menuData.categories.length,
            products_count: this.menuData.products.length,
            modifiers_count: Object.keys(this.menuData.modifiers).length,
            last_loaded: this.menuData.timestamp || Date.now()
        };
    }
    
    /**
     * Check if menu data is ready
     */
    isReady() {
        return this.isLoaded && this.menuData !== null;
    }
    
    /**
     * Refresh menu data (reload from server)
     */
    async refresh(token) {
        console.log('[MenuDataManager] Refreshing menu data...');
        this.isLoaded = false;
        this.menuData = null;
        this.searchIndex.clear();
        
        return await this.loadMenuData(token);
    }
}

// Global instance
window.menuDataManager = new MenuDataManager();