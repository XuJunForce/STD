# 需求文档

## 介绍

小工具平台是一个全新的Web应用程序，旨在为用户提供一个统一的平台来访问和使用各种实用的小工具。该平台采用现代化的前后端分离架构，提供直观的用户界面和高效的工具管理功能。

## 术语表

- **Platform**: 小工具平台系统
- **Tool_Module**: 平台中的单个工具模块
- **Category_Bar**: 顶部分类栏组件
- **Navigation_Panel**: 左侧导航面板
- **Content_Area**: 主体内容区域
- **Frontend**: React前端应用
- **Backend**: FastAPI后端服务
- **Database**: MySQL数据库系统
- **User**: 平台用户
- **Administrator**: 平台管理员
- **CLI_Interface**: 命令行接口组件
- **AI_Agent**: 调用CLI的AI代理
- **Command_Parser**: 命令解析器
- **Output_Handler**: 输出处理器
- **Log_System**: 日志记录和管理系统
- **Tracking_Data**: 工具调用路径中的埋点数据
- **Path_Visualization**: 路径状态可视化组件
- **Log_Interface**: 管理员专用日志管理界面
- **API_Gateway**: API网关和路由管理组件
- **Request_Validator**: API请求参数验证器
- **Response_Formatter**: API响应格式化器
- **Version_Controller**: API版本控制管理器
- **Documentation_Generator**: API文档生成器
- **Security_Handler**: API安全处理组件
- **Cache_Layer**: 缓存层组件
- **Frontend_Cache**: 前端缓存系统
- **Backend_Cache**: 后端缓存系统
- **CLI_Cache**: CLI缓存系统
- **Redis_Store**: Redis缓存存储服务
- **TTL**: 缓存生存时间（Time To Live）
- **Cache_Invalidation**: 缓存失效机制
- **Cache_Strategy**: 缓存策略管理器
- **HTTP_Cache**: HTTP缓存头控制器
- **Content_Hash**: 基于文件内容计算的哈希值
- **LRU**: 最近最少使用（Least Recently Used）缓存淘汰算法
- **Cache_Entry**: 单个缓存条目，包含元数据和缓存数据
- **Hash_Mapping**: 内容哈希到缓存位置的映射关系
- **Storage_Limit**: 缓存存储空间限制
- **Eviction_Policy**: 缓存淘汰策略
- **Cache_Hit_Rate**: 缓存命中率统计指标
- **Privacy_Level**: 缓存隐私级别（用户隔离或全局共享）
- **Cache_Metadata**: 缓存元数据，包含哈希、大小、时间戳等信息

## 需求

### 需求 1: 平台架构

**用户故事:** 作为开发者，我希望平台采用前后端分离架构，以便实现良好的可维护性和扩展性。

#### 验收标准

1. THE Frontend SHALL be built with Vite and React framework
2. THE Backend SHALL be built with FastAPI framework
3. THE Database SHALL use MySQL with root user connection
4. THE Platform SHALL store frontend code in frontend/ directory
5. THE Platform SHALL store backend code in backend/ directory
6. THE Platform SHALL store business logic in backend/services/ directory
7. THE Platform SHALL store API routes in backend/api/ directory
8. THE Platform SHALL store static assets and AI prompts in assets/ directory
9. THE Platform SHALL use uv for Python package management
10. THE Platform SHALL store database configuration in .env file

### 需求 2: 用户界面布局

**用户故事:** 作为用户，我希望有一个直观美观的界面布局，以便轻松导航和使用各种工具。

#### 验收标准

1. THE Category_Bar SHALL be positioned at the top of the interface
2. THE Category_Bar SHALL display categories as oval-shaped tags
3. WHEN a user hovers over a category tag, THE Category_Bar SHALL show micro-animation and gradient highlight effects
4. THE Navigation_Panel SHALL be positioned on the left side of the interface
5. THE Navigation_Panel SHALL support expand and collapse functionality
6. WHEN collapsed, THE Navigation_Panel SHALL display only icons
7. WHEN expanding or collapsing, THE Navigation_Panel SHALL show smooth animation transitions
8. THE Content_Area SHALL be positioned in the main body area
9. THE Content_Area SHALL use large rounded rectangle containers with 16px to 24px border radius
10. THE Content_Area SHALL host specific Tool_Module components

### 需求 3: 工具模块管理

**用户故事:** 作为用户，我希望能够浏览、搜索和使用平台上的各种小工具。

#### 验收标准

1. THE Platform SHALL display available Tool_Module items in categories
2. WHEN a user selects a category, THE Platform SHALL filter and display relevant Tool_Module items
3. THE Platform SHALL provide search functionality for Tool_Module items
4. WHEN a user clicks on a Tool_Module, THE Platform SHALL load the tool in the Content_Area
5. THE Platform SHALL maintain Tool_Module state during user session
6. THE Platform SHALL support multiple Tool_Module instances running simultaneously

### 需求 4: 数据持久化

**用户故事:** 作为系统，我需要持久化存储工具配置和用户数据，以便提供一致的用户体验。

#### 验收标准

1. THE Database SHALL store Tool_Module configurations and metadata
2. THE Database SHALL store user preferences and settings
3. THE Backend SHALL provide RESTful APIs for data operations
4. WHEN data is modified, THE Backend SHALL validate input data before storage
5. THE Backend SHALL handle database connection errors gracefully
6. THE Platform SHALL support data backup and recovery operations

### 需求 5: 版本控制规范

**用户故事:** 作为开发者，我希望有明确的Git分支管理规范，以便团队协作开发。

#### 验收标准

1. THE Platform SHALL use feature-xxx branch naming for new features
2. THE Platform SHALL use bugfix-xxx branch naming for bug fixes
3. THE Platform SHALL use refactor-xxx branch naming for code refactoring
4. THE Platform SHALL use docs-xxx branch naming for documentation updates
5. THE Platform SHALL require pull requests for merging to main branch
6. THE Platform SHALL maintain clean commit history with meaningful messages
7. WHEN a commit is successfully created, THE Platform/Developer SHALL push the current branch to GitHub repository

### 需求 6: 日志系统

**用户故事:** 作为管理员，我希望通过MySQL数据库记录所有小工具调用路径中的埋点数据，以便进行性能优化和问题诊断。

#### 验收标准

1. THE Platform SHALL record all Tool_Module invocation tracking data in MySQL Database
2. WHEN a Tool_Module is invoked, THE Platform SHALL log timestamp, tool type, UI path, and actual execution path
3. THE Platform SHALL provide administrator-only log management interface
4. THE Platform SHALL display log data and path visualization in Frontend
5. THE Platform SHALL visualize path status with color coding (green for successful paths, red for error paths, gray for unused paths)
6. THE Platform SHALL provide log query, filtering, and export functionality
7. THE Platform SHALL support real-time log monitoring and alerting
8. WHERE administrator privileges are verified, THE Platform SHALL grant access to log management interface
9. THE Platform SHALL store tracking data including execution time, tool parameters, and result status
10. THE Platform SHALL provide path visualization showing user journey through Tool_Module interactions
11. WHEN errors occur during Tool_Module execution, THE Platform SHALL log detailed error information and stack traces
12. THE Platform SHALL support log data retention policies and automated cleanup
13. THE Platform SHALL provide log analytics dashboard with usage statistics and performance metrics
14. THE Platform SHALL implement log data backup and recovery mechanisms
15. THE Platform SHALL support log export in multiple formats (JSON, CSV, XML) for external analysis

### 需求 7: 用户体验

**用户故事:** 作为用户，我希望有流畅的交互体验和视觉反馈。

#### 验收标准

1. THE Platform SHALL provide visual feedback for all user interactions
2. WHEN performing actions, THE Platform SHALL show appropriate loading states
3. THE Platform SHALL display error messages in user-friendly format
4. THE Platform SHALL support keyboard navigation for accessibility
5. THE Platform SHALL be responsive across different screen sizes
6. THE Platform SHALL maintain consistent visual design language throughout

### 需求 8: 安全性

**用户故事:** 作为管理员，我希望平台具备基本的安全保护措施。

#### 验收标准

1. THE Backend SHALL validate all input data to prevent injection attacks
2. THE Platform SHALL implement proper error handling without exposing sensitive information
3. THE Backend SHALL use secure database connection practices
4. THE Platform SHALL implement rate limiting for API endpoints
5. THE Platform SHALL log security-related events for monitoring

### 需求 9: 可扩展性

**用户故事:** 作为开发者，我希望平台架构支持未来功能扩展。

#### 验收标准

1. THE Platform SHALL use modular architecture for Tool_Module integration
2. THE Backend SHALL provide plugin-style API for new Tool_Module registration
3. THE Frontend SHALL support dynamic Tool_Module loading
4. THE Platform SHALL maintain backward compatibility when adding new features
5. THE Database SHALL use flexible schema design to accommodate new Tool_Module types

### 需求 10: CLI接口设计

**用户故事:** 作为AI代理，我希望通过命令行接口调用平台工具，以便自动化执行各种任务。

#### 验收标准

1. THE CLI_Interface SHALL provide command-line access to all Tool_Module functions
2. THE CLI_Interface SHALL accept parameters through command-line arguments
3. THE CLI_Interface SHALL support --help flag for each command to display usage information
4. THE CLI_Interface SHALL use consistent command naming convention (kebab-case)
5. THE CLI_Interface SHALL return structured output in JSON format by default
6. WHERE --output-format is specified, THE CLI_Interface SHALL support multiple output formats (json, text, csv)
7. WHEN invalid parameters are provided, THE CLI_Interface SHALL return descriptive error messages with exit code 1
8. THE CLI_Interface SHALL support --verbose flag for detailed operation logging
9. THE CLI_Interface SHALL implement timeout handling for long-running operations
10. THE CLI_Interface SHALL provide progress indicators for operations exceeding 5 seconds

### 需求 11: 工具命令行调用

**用户故事:** 作为AI代理，我希望能够通过统一的命令行接口调用不同的工具功能。

#### 验收标准

1. THE Command_Parser SHALL support tool-specific subcommands (e.g., mini-tools pdf-merge, mini-tools image-convert)
2. THE CLI_Interface SHALL validate required parameters before executing tool operations
3. WHEN a tool requires file inputs, THE CLI_Interface SHALL verify file existence and accessibility
4. THE CLI_Interface SHALL support batch operations through file list parameters
5. THE CLI_Interface SHALL provide dry-run mode (--dry-run) to preview operations without execution
6. THE CLI_Interface SHALL support configuration files for complex parameter sets
7. THE CLI_Interface SHALL implement proper error handling with meaningful exit codes
8. THE CLI_Interface SHALL log all operations to a configurable log file
9. THE CLI_Interface SHALL support parallel execution for independent operations
10. THE CLI_Interface SHALL provide operation status and progress feedback

### 需求 12: AI友好的接口设计

**用户故事:** 作为AI代理，我希望CLI接口设计便于程序化调用和结果解析。

#### 验收标准

1. THE CLI_Interface SHALL return machine-readable JSON output for all operations
2. THE Output_Handler SHALL include operation status, result data, and error information in structured format
3. THE CLI_Interface SHALL support stdin input for piping operations
4. THE CLI_Interface SHALL provide consistent exit codes (0 for success, 1 for user error, 2 for system error)
5. THE CLI_Interface SHALL include operation timing information in verbose output
6. THE CLI_Interface SHALL support environment variable configuration for common parameters
7. WHEN operations produce multiple outputs, THE CLI_Interface SHALL return file paths in predictable JSON structure
8. THE CLI_Interface SHALL support async operation mode with status polling endpoints
9. THE CLI_Interface SHALL provide operation UUID for tracking long-running tasks
10. THE CLI_Interface SHALL include input validation results in error responses

### 需求 14: API设计规范

**用户故事:** 作为开发者，我希望平台遵循标准化的API设计规范，以便提供一致、可维护和易于集成的接口服务。

#### 验收标准

1. THE API_Gateway SHALL implement RESTful API design standards for all endpoints
2. THE Version_Controller SHALL include version number in URL path using format /api/v1/
3. THE Request_Validator SHALL accept standardized request format with username and password fields
4. THE Response_Formatter SHALL return standardized response format with code, message, and data fields
5. THE Response_Formatter SHALL use code 0 for successful operations
6. THE Response_Formatter SHALL use "success" as default message for successful operations
7. THE Response_Formatter SHALL include actual response data in data field
8. THE Documentation_Generator SHALL automatically generate and maintain API documentation
9. THE API_Gateway SHALL implement unified HTTP status code usage standards
10. THE Request_Validator SHALL validate all request parameters according to defined schemas
11. THE Security_Handler SHALL implement API security requirements including authentication and authorization
12. WHEN invalid request format is received, THE Request_Validator SHALL return descriptive error message with appropriate HTTP status code
13. WHEN API version is not specified, THE Version_Controller SHALL default to latest stable version
14. THE Documentation_Generator SHALL provide interactive API testing interface
15. THE API_Gateway SHALL implement rate limiting and request throttling mechanisms
16. THE Security_Handler SHALL validate API keys and tokens for protected endpoints
17. THE Response_Formatter SHALL include request timestamp and processing time in response headers
18. THE API_Gateway SHALL support CORS configuration for cross-origin requests
19. THE Request_Validator SHALL sanitize input data to prevent injection attacks
20. THE Documentation_Generator SHALL maintain API changelog and version history


### 需求 16: 缓存策略

**用户故事:** 作为平台架构师，我希望实现基于内容哈希的工具级自定义缓存策略，以便提高系统性能、减少重复计算、优化存储使用，并为不同工具提供灵活的缓存配置。

#### 验收标准

#### 16.1 工具级自定义配置

1. THE Cache_Strategy SHALL allow each Tool_Module to define its own caching configuration
2. THE Cache_Strategy SHALL support configuration parameters including enabled status, cache type, privacy level, TTL, and storage limits
3. THE Tool_Module SHALL declare cache configuration in its metadata definition
4. WHERE a Tool_Module does not specify cache configuration, THE Cache_Strategy SHALL apply default caching settings
5. THE Cache_Strategy SHALL validate Tool_Module cache configuration during tool registration
6. THE Platform SHALL store Tool_Module cache configurations in Database
7. THE Administrator SHALL be able to override Tool_Module cache configurations through admin interface

#### 16.2 内容哈希缓存机制

8. THE Cache_Layer SHALL compute content hash based on file content rather than file name
9. WHEN multiple files with identical content are processed, THE Cache_Layer SHALL reuse the same cached result
10. THE Cache_Layer SHALL support multi-file input operations by computing combined hash from all input files
11. THE Cache_Layer SHALL normalize and sort parameters before including them in hash computation
12. THE Cache_Layer SHALL use SHA-256 algorithm for content hash generation
13. THE Cache_Layer SHALL store hash-to-cache mappings in Redis_Store
14. WHEN computing combined hash for multiple files, THE Cache_Layer SHALL sort file paths alphabetically before hashing
15. THE Cache_Layer SHALL include normalized tool parameters in hash computation to ensure cache key uniqueness
16. THE Cache_Layer SHALL handle hash collisions by verifying full content match before returning cached results

#### 16.3 存储管理

17. THE Cache_Layer SHALL enforce global storage limit of 100MB for all cached data
18. THE Cache_Layer SHALL implement LRU (Least Recently Used) eviction policy based on storage size
19. WHEN storage limit is reached, THE Cache_Layer SHALL evict least recently used cache entries to free space
20. THE Cache_Layer SHALL monitor real-time storage usage across all cache entries
21. THE Cache_Layer SHALL store cache metadata in Redis_Store and actual cache files in file system
22. THE Cache_Layer SHALL track individual cache entry size for accurate storage accounting
23. THE Cache_Layer SHALL update LRU access timestamps when cache entries are accessed
24. THE Cache_Layer SHALL provide storage usage statistics through monitoring interface
25. WHEN evicting cache entries, THE Cache_Layer SHALL remove both metadata from Redis_Store and files from file system

#### 16.4 TTL配置

26. THE Cache_Layer SHALL apply default TTL of 30 minutes (1800 seconds) for cache entries
27. THE Tool_Module SHALL be able to specify custom TTL value in its cache configuration
28. THE Cache_Layer SHALL automatically expire cache entries when TTL is exceeded
29. THE Cache_Layer SHALL recommend shorter TTL values for Tool_Module handling sensitive data
30. THE Cache_Layer SHALL support TTL range from 60 seconds to 24 hours
31. WHEN cache entry TTL expires, THE Cache_Layer SHALL remove the entry from both Redis_Store and file system
32. THE Cache_Layer SHALL validate TTL values during Tool_Module configuration

#### 16.5 用户控制

33. THE Platform SHALL provide user interface for viewing personal cache entries
34. THE User SHALL be able to view list of cached operations with timestamps and sizes
35. THE User SHALL be able to manually clear all personal cache entries
36. THE User SHALL be able to selectively clear cache entries for specific Tool_Module
37. THE Administrator SHALL be able to clear cache entries for any User
38. THE Platform SHALL display cache entry details including tool name, creation time, size, and expiration time
39. WHEN User clears cache, THE Platform SHALL remove corresponding entries from Redis_Store and file system
40. THE Platform SHALL provide confirmation dialog before clearing cache entries
41. THE Platform SHALL display success message after cache clearing operation completes

#### 16.6 监控和性能分析

42. THE Platform SHALL track cache hit rate statistics categorized by Tool_Module
43. THE Platform SHALL calculate and display computation time saved through cache hits
44. THE Platform SHALL monitor storage space usage rate in real-time
45. THE Platform SHALL analyze cache access frequency for each Tool_Module
46. THE Platform SHALL track LRU eviction statistics including eviction count and freed space
47. THE Platform SHALL display performance metrics in administrator dashboard
48. THE Platform SHALL record cache monitoring data in MySQL Database
49. THE Platform SHALL provide cache performance reports with time-series data
50. THE Platform SHALL calculate average cache hit rate over configurable time periods
51. THE Platform SHALL identify Tool_Module with highest cache efficiency
52. THE Platform SHALL alert Administrator when storage usage exceeds 80% threshold
53. THE Platform SHALL provide cache performance comparison across different Tool_Module
54. THE Platform SHALL track cache miss reasons (expired, evicted, never cached)

#### 16.7 技术实现

55. THE Cache_Layer SHALL use Redis_Store for storing cache metadata and hash mappings
56. THE Cache_Layer SHALL use file system for storing actual cached result files
57. THE Cache_Layer SHALL store cache monitoring data and performance analysis results in MySQL Database
58. THE Cache_Layer SHALL implement atomic operations for cache read and write to prevent race conditions
59. THE Cache_Layer SHALL use Redis transactions for updating cache metadata and LRU timestamps
60. THE Cache_Layer SHALL organize cached files in hierarchical directory structure based on hash prefixes
61. THE Cache_Layer SHALL implement background cleanup process for expired and evicted cache entries
62. THE Cache_Layer SHALL use Redis pub/sub for cache invalidation notifications across distributed instances

#### 16.8 隐私和安全

63. WHERE Tool_Module handles sensitive data, THE Cache_Layer SHALL support user-isolated caching
64. WHERE Tool_Module handles public data, THE Cache_Layer SHALL support global content-hash caching
65. THE Cache_Layer SHALL encrypt cached data for Tool_Module marked as sensitive
66. THE Cache_Layer SHALL prevent cross-user cache access for user-isolated cache entries
67. THE Cache_Layer SHALL include user identifier in cache key for user-isolated caching
68. THE Cache_Layer SHALL validate user permissions before returning cached results
69. THE Cache_Layer SHALL support configurable encryption algorithms for sensitive cache data
70. THE Cache_Layer SHALL securely delete cache files when clearing sensitive data
71. THE Administrator SHALL be able to configure privacy level for each Tool_Module cache policy