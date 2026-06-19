#!/bin/bash
# 同步 GitHub release 到 Gitee
# 用法: ./sync-to-gitee.sh v0.5.1

TAG=$1
if [ -z "$TAG" ]; then
  echo "用法: $0 <tag>"
  echo "示例: $0 v0.5.1"
  exit 1
fi

VERSION=${TAG#v}
GITEE_TOKEN="31fd634eb6eff21e83b2b2d43c7acafa"
GITEE_REPO="air9420/air-icon-launcher"
GITHUB_REPO="Air9420/air-icon-launcher"

echo "同步 $TAG 到 Gitee..."

# 1. 删除旧的 release（如果存在）
echo "检查并删除旧 release..."
RELEASE_ID=$(curl -s "https://gitee.com/api/v5/repos/${GITEE_REPO}/releases" \
  -H "Authorization: token ${GITEE_TOKEN}" | \
  python -c "import sys,json; releases=json.load(sys.stdin); print(next((r['id'] for r in releases if r['tag_name']=='${TAG}'), ''))" 2>/dev/null)

if [ -n "$RELEASE_ID" ]; then
  echo "删除旧 release ID: $RELEASE_ID"
  curl -s -X DELETE "https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/${RELEASE_ID}" \
    -H "Authorization: token ${GITEE_TOKEN}"
fi

# 2. 创建新 release
echo "创建新 release..."
RELEASE_ID=$(curl -s -X POST "https://gitee.com/api/v5/repos/${GITEE_REPO}/releases" \
  -H "Authorization: token ${GITEE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"tag_name\": \"${TAG}\",
    \"name\": \"${TAG}\",
    \"body\": \"Sync from GitHub release ${TAG}\",
    \"draft\": false,
    \"prerelease\": false,
    \"target_commitish\": \"main\"
  }" | python -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

echo "新 release ID: $RELEASE_ID"

# 3. 下载 GitHub 文件
TEMP_DIR=$(mktemp -d)
echo "下载 GitHub 文件到 $TEMP_DIR..."

curl -s -L -o "$TEMP_DIR/latest.json" \
  "https://github.com/${GITHUB_REPO}/releases/download/${TAG}/latest.json"

curl -s -L -o "$TEMP_DIR/air-icon-launcher_${VERSION}_x64-setup.exe" \
  "https://github.com/${GITHUB_REPO}/releases/download/${TAG}/air-icon-launcher_${VERSION}_x64-setup.exe"

curl -s -L -o "$TEMP_DIR/air-icon-launcher_${VERSION}_x64-setup.nsis.zip" \
  "https://github.com/${GITHUB_REPO}/releases/download/${TAG}/air-icon-launcher_${VERSION}_x64-setup.nsis.zip"

curl -s -L -o "$TEMP_DIR/air-icon-launcher_${VERSION}_x64-setup.nsis.zip.sig" \
  "https://github.com/${GITHUB_REPO}/releases/download/${TAG}/air-icon-launcher_${VERSION}_x64-setup.nsis.zip.sig"

# 4. 修改 latest.json 中的 URL
echo "修改 latest.json URL..."
sed -i "s|https://github.com/${GITHUB_REPO}/releases/download|https://gitee.com/${GITEE_REPO}/releases/download|g" "$TEMP_DIR/latest.json"

# 5. 上传到 Gitee
echo "上传文件到 Gitee..."
for file in latest.json "air-icon-launcher_${VERSION}_x64-setup.exe" "air-icon-launcher_${VERSION}_x64-setup.nsis.zip" "air-icon-launcher_${VERSION}_x64-setup.nsis.zip.sig"; do
  echo "  上传 $file..."
  curl -s -X POST "https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/${RELEASE_ID}/attach_files" \
    -H "Authorization: token ${GITEE_TOKEN}" \
    -F "file=@${TEMP_DIR}/${file}" > /dev/null
done

# 6. 清理
rm -rf "$TEMP_DIR"

echo "完成！"
echo "Gitee release: https://gitee.com/${GITEE_REPO}/releases/tag/${TAG}"
