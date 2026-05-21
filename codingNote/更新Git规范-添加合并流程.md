# 更新Git规范 - 添加合并流程

**日期**: 2026-05-21
**类型**: 规范更新

## 更新内容

### Git工作流完善

**之前**:
```
分支 → 提交 → Push
```

**现在**:
```
1. 创建分支并开发
2. 提交代码（清晰message）
3. Push到GitHub
4. 合并到main分支
5. 删除功能分支（可选）
```

## 详细流程

### 1. 创建功能分支
```bash
git checkout -b feature-xxx
# 或
git checkout -b bugfix-xxx
```

### 2. 开发并提交
```bash
# 开发代码...
git add .
git commit -m "feat: 添加xxx功能"
```

### 3. Push到远程
```bash
git push origin feature-xxx
```

### 4. 合并到main分支
```bash
# 切换到main分支
git checkout main

# 拉取最新代码
git pull origin main

# 合并功能分支
git merge feature-xxx

# Push合并后的main
git push origin main
```

### 5. 删除功能分支（可选）
```bash
# 删除本地分支
git branch -d feature-xxx

# 删除远程分支
git push origin --delete feature-xxx
```

## Commit Message规范

推荐使用语义化提交：
- `feat:` 新功能
- `fix:` Bug修复
- `docs:` 文档更新
- `refactor:` 重构
- `style:` 代码格式
- `test:` 测试相关
- `chore:` 构建/工具变动

**示例**:
```bash
git commit -m "feat: 实现CLI包级架构"
git commit -m "fix: 修复缓存哈希计算错误"
git commit -m "docs: 更新API文档"
```

## 注意事项

1. **合并前检查**: 确保功能完整、测试通过
2. **冲突处理**: 合并时如有冲突，需手动解决
3. **代码审查**: 重要功能建议通过PR进行代码审查
4. **分支清理**: 合并后及时删除功能分支，保持仓库整洁

## 更新的检查清单

在原有检查清单中新增：
- [x] Git提交后push
- [x] **合并到main分支**

## 相关文件

- `.agents/skills/rules/skill.md` - 更新了Git规范部分
- 检查清单 - 添加了"合并到main分支"项

## 下一步

- [ ] 在实际开发中遵循此流程
- [ ] 考虑是否需要PR审查流程
- [ ] 考虑是否需要CI/CD自动化测试
