terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region"           { default = "us-east-1" }
variable "environment"          { default = "dev" }
variable "bedrock_model_id"     { default = "anthropic.claude-3-haiku-20240307-v1:0" }
variable "generation_model_id"  { default = "anthropic.claude-3-5-sonnet-20241022-v2:0" }
variable "embedding_model_id"   { default = "amazon.titan-embed-text-v2:0" }

locals {
  prefix = "ai-doc-classifier-${var.environment}"
  tags   = { Environment = var.environment, Project = "ai-document-classifier" }
}

# ── S3 bucket for source documents ────────────────────────────────────────────

resource "aws_s3_bucket" "documents" {
  bucket = "${local.prefix}-documents"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# ── DynamoDB vector store ──────────────────────────────────────────────────────
# Stores document content + JSON-serialised 512-d embeddings.
# For production at scale, replace with Amazon OpenSearch Serverless k-NN.

resource "aws_dynamodb_table" "vectors" {
  name         = "${local.prefix}-vectors"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "documentId"

  attribute {
    name = "documentId"
    type = "S"
  }

  tags = local.tags
}

# ── IAM role for all Lambda functions ─────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.prefix}-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ReadDocuments"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
      },
      {
        Sid    = "BedrockInvokeModels"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_model_id}",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.generation_model_id}",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.embedding_model_id}",
        ]
      },
      {
        Sid    = "DynamoDBVectorStore"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:Query",
        ]
        Resource = aws_dynamodb_table.vectors.arn
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ── Shared Lambda environment variables ───────────────────────────────────────

locals {
  lambda_env = {
    ENVIRONMENT        = var.environment
    DOCUMENTS_BUCKET   = aws_s3_bucket.documents.bucket
    VECTOR_STORE_TABLE = aws_dynamodb_table.vectors.name
    BEDROCK_MODEL_ID   = var.bedrock_model_id
    GENERATION_MODEL_ID = var.generation_model_id
    EMBEDDING_MODEL_ID  = var.embedding_model_id
    LOG_LEVEL          = var.environment == "prod" ? "info" : "debug"
  }
}

# ── Lambda: /classify ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "classifier" {
  filename      = "../../function.zip"
  function_name = "${local.prefix}-classifier"
  role          = aws_iam_role.lambda.arn
  handler       = "handlers/classifyHandler.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 512
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── Lambda: /index ─────────────────────────────────────────────────────────────

resource "aws_lambda_function" "indexer" {
  filename      = "../../function.zip"
  function_name = "${local.prefix}-indexer"
  role          = aws_iam_role.lambda.arn
  handler       = "handlers/indexHandler.handler"
  runtime       = "nodejs20.x"
  timeout       = 60   # classify + embed = two Bedrock calls
  memory_size   = 512
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── Lambda: /query (RAG) ───────────────────────────────────────────────────────

resource "aws_lambda_function" "query" {
  filename      = "../../function.zip"
  function_name = "${local.prefix}-query"
  role          = aws_iam_role.lambda.arn
  handler       = "handlers/queryHandler.handler"
  runtime       = "nodejs20.x"
  timeout       = 60   # embed + DynamoDB scan + generation
  memory_size   = 1024 # larger for in-memory cosine similarity over many docs
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── Lambda: DELETE /documents/{documentId} ─────────────────────────────────────

resource "aws_lambda_function" "deleter" {
  filename      = "../../function.zip"
  function_name = "${local.prefix}-deleter"
  role          = aws_iam_role.lambda.arn
  handler       = "handlers/deleteHandler.handler"
  runtime       = "nodejs20.x"
  timeout       = 15
  memory_size   = 256
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── API Gateway HTTP API ───────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = local.prefix
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["Content-Type"]
  }
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true
}

# Integrations

resource "aws_apigatewayv2_integration" "classifier" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.classifier.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "indexer" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.indexer.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "query" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.query.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "deleter" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.deleter.invoke_arn
  integration_method = "POST"
}

# Routes

resource "aws_apigatewayv2_route" "classify" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /classify"
  target    = "integrations/${aws_apigatewayv2_integration.classifier.id}"
}

resource "aws_apigatewayv2_route" "index" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /index"
  target    = "integrations/${aws_apigatewayv2_integration.indexer.id}"
}

resource "aws_apigatewayv2_route" "query" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /query"
  target    = "integrations/${aws_apigatewayv2_integration.query.id}"
}

resource "aws_apigatewayv2_route" "delete_document" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /documents/{documentId}"
  target    = "integrations/${aws_apigatewayv2_integration.deleter.id}"
}

# Lambda permissions

resource "aws_lambda_permission" "api_gw_classifier" {
  statement_id  = "AllowAPIGatewayClassifier"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classifier.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_indexer" {
  statement_id  = "AllowAPIGatewayIndexer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.indexer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_query" {
  statement_id  = "AllowAPIGatewayQuery"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.query.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_gw_deleter" {
  statement_id  = "AllowAPIGatewayDeleter"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.deleter.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "classify_endpoint" {
  value = "${aws_apigatewayv2_stage.main.invoke_url}/classify"
}

output "index_endpoint" {
  value = "${aws_apigatewayv2_stage.main.invoke_url}/index"
}

output "query_endpoint" {
  value = "${aws_apigatewayv2_stage.main.invoke_url}/query"
}

output "delete_endpoint" {
  value = "${aws_apigatewayv2_stage.main.invoke_url}/documents/{documentId}"
}

output "vector_store_table" {
  value = aws_dynamodb_table.vectors.name
}
