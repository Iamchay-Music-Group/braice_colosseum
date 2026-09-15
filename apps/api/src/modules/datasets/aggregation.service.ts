// Aggregation service
// CORE PIPELINE: Transforms individual data into community intelligence
//
// Input: 1000 individual activity records
// Example: member_001 -> sneakers, member_002 -> streetwear, ...
//
// Aggregation:
//   GROUP BY interest_category
//   COUNT(*)
//   Calculate percentage
//
// Output: Community dataset
// Example:
//   {
//     "streetwear": 42,
//     "music_festivals": 31,
//     "sneakers": 27,
//     "beauty": 18
//   }
//
// CRITICAL: The output contains NO individual member information.
// This separation is central to the BRAICE concept.
