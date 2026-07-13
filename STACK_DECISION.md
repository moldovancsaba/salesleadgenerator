# Stack Decision: Mongoose vs Prisma

## Decision
**CogMap uses Mongoose (MongoDB ODM) instead of Prisma.**

## Rationale

### Context
The Check platform standard (per MEMORY.md) specifies "Prisma + MongoDB Atlas (primary)" as the tech stack. However, CogMap is a separate project from the Check platform, and has made a deliberate choice to use Mongoose instead.

### Why Mongoose for CogMap?

1. **Simpler Schema Evolution**: CogMap's lead schema is relatively simple and may evolve rapidly. Mongoose's schema definition is more flexible for quick iterations without migration overhead.

2. **Direct MongoDB Access**: CogMap needs fine-grained control over MongoDB queries (aggregations, text search, geospatial queries for regional leads). Mongoose provides more direct access to MongoDB driver features.

3. **Lighter Weight**: CogMap is a standalone webapp, not part of the larger Check monorepo. Mongoose has a smaller footprint and doesn't require Prisma's code generation step.

4. **Existing Implementation**: The current CogMap implementation already uses Mongoose successfully. Migrating to Prisma would require:
   - Rewriting all models
   - Rewriting all database queries
   - Setting up Prisma migrations
   - Testing the entire data layer
   - Risk of breaking existing functionality

5. **No Cross-Project Dependencies**: CogMap doesn't share models or database connections with the Check platform, so there's no benefit to using the same ORM.

### Trade-offs

**Pros of Mongoose:**
- Simpler for rapid prototyping
- More flexible schema evolution
- Direct MongoDB driver access
- No code generation step
- Smaller dependency footprint

**Cons of Mongoose:**
- Less type safety than Prisma's generated types
- No automatic migration system
- Different from Check platform standard
- Manual index management

### Migration Path (If Needed)

If CogMap ever needs to align with Check platform standards or integrate with Check services:

1. Create Prisma schema matching current Mongoose models
2. Run `prisma db pull` to generate schema from existing database
3. Migrate queries incrementally (can use both ORMs temporarily)
4. Test thoroughly before removing Mongoose
5. Update all API routes to use Prisma client

### Conclusion

**Mongoose is the right choice for CogMap's current needs.** The decision prioritizes development speed and flexibility over strict adherence to platform standards. This can be revisited if CogMap's requirements change or if integration with Check platform becomes necessary.

---

**Date**: 2026-07-13  
**Status**: Documented decision  
**Next Review**: When CogMap requirements change or Check platform integration is needed
