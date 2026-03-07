terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region"        { default = "us-east-1" }
variable "environment"       { default = "dev" }
variable "bedrock_model_id"  { default = "anthropic.claude-3-haiku-20240307-v1:0" }

# S3 bucket for documents
resource "aws_s3_bucket" "documents" {
  bucket = "ai-doc-classifier-${var.environment}-documents"
  tags   = { Environment = var.environment, Project = "ai-document-classifier" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# IAM role for Lambda
resource "aws_iam_role" "lambda" {
  name = "ai-doc-classifier-${var.environment}-role"
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
  name = "ai-doc-classifier-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = ["${aws_s3_bucket.documents.arn}", "${aws_s3_bucket.documents.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_model_id}"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Lambda function
resource "aws_lambda_function" "classifier" {
  filename         = "../../function.zip"
  function_name    = "ai-doc-classifier-${var.environment}"
  role             = aws_iam_role.lambda.arn
  handler          = "handlers/classifyHandler.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ENVIRONMENT      = var.environment
      DOCUMENTS_BUCKET = aws_s3_bucket.documents.bucket
      BEDROCK_MODEL_ID = var.bedrock_model_id
      LOG_LEVEL        = var.environment == "prod" ? "info" : "debug"
    }
  }

  tags = { Environment = var.environment }
}

# API Gateway
resource "aws_apigatewayv2_api" "main" {
  name          = "ai-doc-classifier-${var.environment}"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.classifier.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "classify" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /classify"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classifier.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

output "api_endpoint" {
  value = "${aws_apigatewayv2_stage.main.invoke_url}/classify"
}
